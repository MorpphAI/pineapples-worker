import { AvantioApiGateway } from "../../../apiGateways/avantio/getAppointments";
import { classifyCleaningRequirement, isSameDayTurnover } from "../../../domain/scale/bookingClassification";
import {
  classifyCalendarRecord,
  extractCalendarRecordComment,
} from "../../../domain/scale/calendarRecordClassification";
import {
  AuthorizationSyncResult,
  AuthorizationSyncStatus,
  PineOSKanbanAuthorizationClient,
} from "../../../repositories/kanban/pineosKanbanAuthorizationClient";
import { AvantioBooking } from "../../../types/avantioTypes";
import { Env } from "../../../types/configTypes";
import { isValidBookingStatus } from "../../../utils/scaleUtils";

const AUTHORIZATION_SOURCE = "avantio-status-sync";
const SENSITIVE_DIAGNOSTIC_FIELDS = new Set([
  "email",
  "e-mail",
  "phone",
  "telefone",
  "document",
  "documento",
  "address",
  "endereco",
  "endereço",
]);

export type SyncAuthorizationStatusResult = {
  success: boolean;
  date: string;
  summary: {
    rawCheckins: number;
    rawCheckouts: number;
    validCheckins: number;
    validCheckouts: number;
    dateMismatchCheckinsSkipped: number;
    dateMismatchCheckoutsSkipped: number;
    operationalBlocksSkipped: number;
    unknownRecordsSkipped: number;
    duplicateCheckinsSuppressed: number;
    duplicateCheckoutsSuppressed: number;
    candidates: number;
    ambiguousAccommodations: number;
    updated: number;
    unchanged: number;
    skipped: number;
    manualSkipped: number;
    errors: number;
  };
  results: Array<{
    accommodationId: string;
    propertyCode?: string | null;
    computedStatus?: AuthorizationSyncStatus | null;
    rpcStatus: string;
    reason?: string;
    cardId?: string;
    previousStatus?: string | null;
    newStatus?: string | null;
    error?: string;
    operationalBlock?: OperationalBlockPayload | null;
  }>;
};

type AvantioAuthorizationGateway = Pick<AvantioApiGateway, "getCheckins" | "getCheckouts">;
type KanbanAuthorizationClient = Pick<PineOSKanbanAuthorizationClient, "syncAuthorization">;
type IdempotencyKeyBuilder = (targetDate: string, accommodationId: string) => string;

type DeduplicationResult = {
  bookings: AvantioBooking[];
  suppressed: number;
};

type ClassifiedCalendarRecords = {
  realStays: AvantioBooking[];
  operationalBlocks: AvantioBooking[];
  unknowns: AvantioBooking[];
};

type OperationalBlockPayload = {
  id: string | null;
  reference: string | null;
  arrival: string | null;
  departure: string | null;
  comment: string | null;
};

type SafeBookingDiagnostic = {
  accommodationId: string | null;
  bookingId: string | null;
  reference: string | null;
  status: string | null;
  arrival: string | null;
  departure: string | null;
  calendarRecordKind?: string;
  reason?: string;
  hasComment?: boolean;
  topLevelFieldNames: string[];
  classificationSignals?: Record<string, boolean>;
};

const ALLOWED_CLASSIFICATION_SIGNAL_NAMES = [
  "explicitOperationalType",
  "hasGuestIdentity",
  "hasExternalReservationEvidence",
  "hasPositiveAmount",
  "hasZeroAmount",
  "hasRawPositiveOccupancy",
  "hasEffectiveGuestOccupancyEvidence",
  "hasPlaceholderOccupancyPattern",
  "hasComment",
  "usedLegacyFallback",
] as const;

export function normalizeAvantioDate(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function checkoutMatchesTargetDate(booking: AvantioBooking, targetDate: string): boolean {
  return normalizeAvantioDate(booking.stayDates?.departure) === targetDate;
}

export function checkinMatchesTargetDate(booking: AvantioBooking, targetDate: string): boolean {
  return normalizeAvantioDate(booking.stayDates?.arrival) === targetDate;
}

export function getStableBookingIdentity(booking: AvantioBooking): string | null {
  return firstPresent([
    booking.id,
    booking.reference,
    booking.externalData?.reference,
    booking.id1,
  ]);
}

export function getLogicalBookingSignature(booking: AvantioBooking): string {
  const fallbackReference = firstPresent([
    booking.reference,
    booking.externalData?.reference,
    booking.id1,
  ]) ?? "";

  return [
    booking.accommodationId ?? "",
    normalizeAvantioDate(booking.stayDates?.arrival) ?? String(booking.stayDates?.arrival ?? ""),
    normalizeAvantioDate(booking.stayDates?.departure) ?? String(booking.stayDates?.departure ?? ""),
    booking.status ?? "",
    fallbackReference,
  ].join("|");
}

export function deduplicateBookings(bookings: AvantioBooking[]): DeduplicationResult {
  const seenIdentities = new Set<string>();
  const seenSignatures = new Set<string>();
  const deduplicated: AvantioBooking[] = [];
  let suppressed = 0;

  for (const booking of [...bookings].sort(compareBookingsForDeduplication)) {
    const identity = getStableBookingIdentity(booking);
    if (identity && seenIdentities.has(identity)) {
      logSafeAuthorizationEvent("duplicate_suppressed", buildSafeBookingDiagnostic(booking, {
        reason: "duplicate_stable_identity",
      }));
      suppressed += 1;
      continue;
    }

    const signature = getLogicalBookingSignature(booking);
    if (seenSignatures.has(signature)) {
      logSafeAuthorizationEvent("duplicate_suppressed", buildSafeBookingDiagnostic(booking, {
        reason: "duplicate_logical_signature",
      }));
      suppressed += 1;
      if (identity) seenIdentities.add(identity);
      continue;
    }

    if (identity) seenIdentities.add(identity);
    seenSignatures.add(signature);
    deduplicated.push(booking);
  }

  return { bookings: deduplicated, suppressed };
}

function compareBookingsForDeduplication(left: AvantioBooking, right: AvantioBooking): number {
  const leftSignature = getLogicalBookingSignature(left);
  const rightSignature = getLogicalBookingSignature(right);
  const signatureCompare = leftSignature.localeCompare(rightSignature);
  if (signatureCompare !== 0) return signatureCompare;

  return (getStableBookingIdentity(left) ?? "").localeCompare(getStableBookingIdentity(right) ?? "");
}

export function groupBookingsByAccommodation(bookings: AvantioBooking[]): Map<string, AvantioBooking[]> {
  const grouped = new Map<string, AvantioBooking[]>();

  for (const booking of bookings) {
    const existing = grouped.get(booking.accommodationId) ?? [];
    existing.push(booking);
    grouped.set(booking.accommodationId, existing);
  }

  return grouped;
}

export function classifyCalendarRecords(bookings: AvantioBooking[]): ClassifiedCalendarRecords {
  const classified: ClassifiedCalendarRecords = {
    realStays: [],
    operationalBlocks: [],
    unknowns: [],
  };

  for (const booking of bookings) {
    const classification = classifyCalendarRecord(booking);
    if (classification.kind === "OPERATIONAL_BLOCK") {
      logSafeAuthorizationEvent("operational_block", buildSafeBookingDiagnostic(booking, {
        calendarRecordKind: classification.kind,
        hasComment: classification.signals.hasComment,
        classificationSignals: classification.signals,
      }));
      classified.operationalBlocks.push(booking);
      continue;
    }
    if (classification.kind === "UNKNOWN") {
      logSafeAuthorizationEvent("unknown_calendar_record", buildSafeBookingDiagnostic(booking, {
        calendarRecordKind: classification.kind,
        hasComment: classification.signals.hasComment,
        classificationSignals: classification.signals,
      }));
      classified.unknowns.push(booking);
      continue;
    }
    classified.realStays.push(booking);
  }

  return classified;
}

export function buildIdempotencyKey(date: string, accommodationId: string): string {
  return `${AUTHORIZATION_SOURCE}:${date}:${accommodationId}`;
}

export function buildSafeBookingDiagnostic(
  booking: AvantioBooking,
  extra: Partial<Omit<SafeBookingDiagnostic, "accommodationId" | "bookingId" | "reference" | "status" | "arrival" | "departure" | "topLevelFieldNames">> = {},
): SafeBookingDiagnostic {
  const { classificationSignals, ...safeExtra } = extra;

  return {
    accommodationId: stringOrNull(booking.accommodationId),
    bookingId: stringOrNull(booking.id),
    reference: firstPresent([booking.reference, booking.externalData?.reference, booking.id1]),
    status: stringOrNull(booking.status),
    arrival: normalizeAvantioDate(booking.stayDates?.arrival),
    departure: normalizeAvantioDate(booking.stayDates?.departure),
    topLevelFieldNames: Object.keys(booking)
      .filter((field) => !SENSITIVE_DIAGNOSTIC_FIELDS.has(field.toLowerCase()))
      .sort(),
    ...safeExtra,
    ...(classificationSignals
      ? { classificationSignals: buildSafeClassificationSignals(classificationSignals) }
      : {}),
  };
}

function buildSafeClassificationSignals(signals: Record<string, unknown>): Record<string, boolean> {
  const safeSignals: Record<string, boolean> = {};

  for (const signalName of ALLOWED_CLASSIFICATION_SIGNAL_NAMES) {
    safeSignals[signalName] = signals[signalName] === true;
  }

  return safeSignals;
}

function logSafeAuthorizationEvent(event: string, diagnostic: SafeBookingDiagnostic): void {
  console.log("[AuthorizationSync]", {
    event,
    ...diagnostic,
  });
}

function firstPresent(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export class SyncAuthorizationStatusService {
  private readonly avantioApiGateway: AvantioAuthorizationGateway;
  private readonly kanbanClient: KanbanAuthorizationClient;
  private readonly idempotencyKeyBuilder: IdempotencyKeyBuilder;

  constructor(
    env: Env,
    avantioApiGateway: AvantioAuthorizationGateway = new AvantioApiGateway(env),
    kanbanClient: KanbanAuthorizationClient = new PineOSKanbanAuthorizationClient(env),
    idempotencyKeyBuilder: IdempotencyKeyBuilder = buildIdempotencyKey,
  ) {
    this.avantioApiGateway = avantioApiGateway;
    this.kanbanClient = kanbanClient;
    this.idempotencyKeyBuilder = idempotencyKeyBuilder;
  }

  async sync(date: string): Promise<SyncAuthorizationStatusResult> {
    const [rawCheckins, rawCheckouts] = await Promise.all([
      this.avantioApiGateway.getCheckins(date),
      this.avantioApiGateway.getCheckouts(date),
    ]);

    const validCheckins = rawCheckins.filter((booking) => isValidBookingStatus(booking.status));
    const validCheckouts = rawCheckouts.filter((booking) => isValidBookingStatus(booking.status));
    const targetDate = normalizeAvantioDate(date) ?? date;
    const dateMatchedCheckins = validCheckins.filter((booking) => checkinMatchesTargetDate(booking, targetDate));
    const dateMatchedCheckouts = validCheckouts.filter((booking) => checkoutMatchesTargetDate(booking, targetDate));
    const deduplicatedCheckins = deduplicateBookings(dateMatchedCheckins);
    const deduplicatedCheckouts = deduplicateBookings(dateMatchedCheckouts);
    const classifiedCheckins = classifyCalendarRecords(deduplicatedCheckins.bookings);
    const classifiedCheckouts = classifyCalendarRecords(deduplicatedCheckouts.bookings);
    const checkinsByAccommodation = groupBookingsByAccommodation(classifiedCheckins.realStays);
    const checkoutsByAccommodation = groupBookingsByAccommodation(classifiedCheckouts.realStays);
    const operationalCheckinsByAccommodation = groupBookingsByAccommodation(classifiedCheckins.operationalBlocks);
    const operationalCheckoutsByAccommodation = groupBookingsByAccommodation(classifiedCheckouts.operationalBlocks);
    const unknownCheckinsByAccommodation = groupBookingsByAccommodation(classifiedCheckins.unknowns);
    const unknownCheckoutsByAccommodation = groupBookingsByAccommodation(classifiedCheckouts.unknowns);

    const result: SyncAuthorizationStatusResult = {
      success: true,
      date,
      summary: {
        rawCheckins: rawCheckins.length,
        rawCheckouts: rawCheckouts.length,
        validCheckins: validCheckins.length,
        validCheckouts: validCheckouts.length,
        dateMismatchCheckinsSkipped: validCheckins.length - dateMatchedCheckins.length,
        dateMismatchCheckoutsSkipped: validCheckouts.length - dateMatchedCheckouts.length,
        operationalBlocksSkipped: classifiedCheckins.operationalBlocks.length + classifiedCheckouts.operationalBlocks.length,
        unknownRecordsSkipped: classifiedCheckins.unknowns.length + classifiedCheckouts.unknowns.length,
        duplicateCheckinsSuppressed: deduplicatedCheckins.suppressed,
        duplicateCheckoutsSuppressed: deduplicatedCheckouts.suppressed,
        candidates: 0,
        ambiguousAccommodations: 0,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        manualSkipped: 0,
        errors: 0,
      },
      results: [],
    };
    const sentIdempotencyKeys = new Set<string>();

    const accommodationIds = Array.from(new Set([
      ...checkoutsByAccommodation.keys(),
      ...operationalCheckoutsByAccommodation.keys(),
      ...operationalCheckinsByAccommodation.keys(),
      ...unknownCheckoutsByAccommodation.keys(),
      ...Array.from(unknownCheckinsByAccommodation.keys()).filter((id) => checkoutsByAccommodation.has(id)),
    ])).sort();
    const processedAccommodationIds = new Set<string>();

    for (const accommodationId of accommodationIds) {
      if (processedAccommodationIds.has(accommodationId)) continue;
      processedAccommodationIds.add(accommodationId);

      const checkouts = checkoutsByAccommodation.get(accommodationId) ?? [];
      const checkins = checkinsByAccommodation.get(accommodationId) ?? [];
      const operationalCheckouts = operationalCheckoutsByAccommodation.get(accommodationId) ?? [];
      const operationalCheckins = operationalCheckinsByAccommodation.get(accommodationId) ?? [];
      const unknownCheckouts = unknownCheckoutsByAccommodation.get(accommodationId) ?? [];
      const unknownCheckins = unknownCheckinsByAccommodation.get(accommodationId) ?? [];

      if (unknownCheckouts.length > 0 || (checkouts.length > 0 && unknownCheckins.length > 0)) {
        this.countLocalSkip(result);
        this.logAccommodationSkip("unknown_calendar_record", [...unknownCheckouts, ...unknownCheckins, ...checkouts]);
        result.results.push({
          accommodationId,
          propertyCode: this.getConsistentPropertyCode([...unknownCheckouts, ...checkouts]),
          computedStatus: null,
          rpcStatus: "skipped",
          reason: "unknown_calendar_record",
        });
        continue;
      }

      if (checkouts.length === 0 && operationalCheckouts.length > 0) {
        this.countLocalSkip(result);
        result.results.push({
          accommodationId,
          propertyCode: this.getConsistentPropertyCode(operationalCheckouts),
          computedStatus: null,
          rpcStatus: "skipped",
          reason: "operational_block",
          operationalBlock: this.getSingleOperationalBlockPayload(operationalCheckouts),
        });
        continue;
      }

      if (checkouts.length === 0 && operationalCheckins.length > 0) {
        this.countLocalSkip(result);
        result.results.push({
          accommodationId,
          propertyCode: this.getConsistentPropertyCode(operationalCheckins),
          computedStatus: null,
          rpcStatus: "skipped",
          reason: "operational_block",
          operationalBlock: this.getSingleOperationalBlockPayload(operationalCheckins),
        });
        continue;
      }

      if (checkouts.length > 1) {
        this.countLocalAmbiguity(result);
        this.logAccommodationSkip("ambiguous_multiple_checkouts", checkouts);
        result.results.push({
          accommodationId,
          propertyCode: this.getConsistentPropertyCode(checkouts),
          computedStatus: null,
          rpcStatus: "skipped",
          reason: "ambiguous_multiple_checkouts",
        });
        continue;
      }

      if (checkins.length > 1) {
        this.countLocalAmbiguity(result);
        this.logAccommodationSkip("ambiguous_multiple_checkins", [...checkouts, ...checkins]);
        result.results.push({
          accommodationId,
          propertyCode: this.getConsistentPropertyCode(checkouts),
          computedStatus: null,
          rpcStatus: "skipped",
          reason: "ambiguous_multiple_checkins",
        });
        continue;
      }

      if (checkouts.length !== 1) continue;

      const bookingOut = checkouts[0];
      const bookingIn = checkins.length === 1 ? checkins[0] : null;
      const operationalBlock = this.getSingleOperationalBlockPayload([
        ...operationalCheckouts,
        ...operationalCheckins,
      ]);
      const classification = classifyCleaningRequirement(bookingOut, bookingIn);
      const computedStatus: AuthorizationSyncStatus = isSameDayTurnover(classification) ? "tim" : "out";
      const propertyCode = this.getPropertyCode(bookingOut);
      const idempotencyKey = this.idempotencyKeyBuilder(targetDate, bookingOut.accommodationId);
      const payload = {
        date,
        idempotency_key: idempotencyKey,
        accommodation_id: bookingOut.accommodationId,
        booking_out_id: bookingOut.id,
        booking_in_id: bookingIn?.id ?? null,
        booking_out_reference: bookingOut.reference ?? null,
        booking_in_reference: bookingIn?.reference ?? null,
        booking_out_status: bookingOut.status,
        booking_in_status: bookingIn?.status ?? null,
        classification,
        operational_block: operationalBlock,
        detected_at: new Date().toISOString(),
        source: AUTHORIZATION_SOURCE,
      };

      if (sentIdempotencyKeys.has(idempotencyKey)) {
        this.countLocalSkip(result);
        result.results.push({
          accommodationId: bookingOut.accommodationId,
          propertyCode,
          computedStatus,
          rpcStatus: "skipped",
          reason: "duplicate_idempotency_key_in_execution",
        });
        continue;
      }
      sentIdempotencyKeys.add(idempotencyKey);

      result.summary.candidates += 1;

      try {
        const syncResult = await this.kanbanClient.syncAuthorization({
          accommodationId: bookingOut.accommodationId,
          propertyCode,
          targetDate: date,
          authorizationStatus: computedStatus,
          idempotencyKey,
          payload,
        });

        this.countSyncResult(result, syncResult);
        result.results.push({
          accommodationId: bookingOut.accommodationId,
          propertyCode,
          computedStatus,
          rpcStatus: syncResult.status,
          reason: syncResult.reason,
          cardId: syncResult.card_id,
          previousStatus: syncResult.previous_status,
          newStatus: syncResult.new_status,
        });
      } catch (error: unknown) {
        result.summary.errors += 1;
        logSafeAuthorizationEvent("pineos_sync_error", buildSafeBookingDiagnostic(bookingOut, {
          reason: error instanceof Error ? error.message : String(error),
        }));
        result.results.push({
          accommodationId: bookingOut.accommodationId,
          propertyCode,
          computedStatus,
          rpcStatus: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    result.success = result.summary.errors === 0;
    return result;
  }

  private getPropertyCode(bookingOut: AvantioBooking): string | null {
    return firstPresent([
      bookingOut.externalData?.reference,
      bookingOut.reference,
      bookingOut.id1,
    ]);
  }

  private getConsistentPropertyCode(bookings: AvantioBooking[]): string | null {
    let propertyCode: string | null = null;

    for (const booking of bookings) {
      const current = this.getPropertyCode(booking);
      if (!current) continue;
      if (!propertyCode) {
        propertyCode = current;
        continue;
      }
      if (propertyCode !== current) return null;
    }

    return propertyCode;
  }

  private getSingleOperationalBlockPayload(bookings: AvantioBooking[]): OperationalBlockPayload | null {
    if (bookings.length === 0) return null;

    for (const block of [...bookings].sort(compareBookingsForDeduplication)) {
      const comment = extractCalendarRecordComment(block);

      return {
        id: firstPresent([block.id]) ?? null,
        reference: firstPresent([block.reference, block.externalData?.reference, block.id1]) ?? null,
        arrival: normalizeAvantioDate(block.stayDates?.arrival) ?? null,
        departure: normalizeAvantioDate(block.stayDates?.departure) ?? null,
        comment: comment.comment ?? null,
      };
    }

    return null;
  }

  private countLocalAmbiguity(result: SyncAuthorizationStatusResult): void {
    result.summary.ambiguousAccommodations += 1;
    this.countLocalSkip(result);
  }

  private countLocalSkip(result: SyncAuthorizationStatusResult): void {
    result.summary.skipped += 1;
  }

  private logAccommodationSkip(reason: string, bookings: AvantioBooking[]): void {
    for (const booking of bookings) {
      logSafeAuthorizationEvent("accommodation_skipped", buildSafeBookingDiagnostic(booking, { reason }));
      return;
    }
  }

  private countSyncResult(result: SyncAuthorizationStatusResult, syncResult: AuthorizationSyncResult): void {
    if (syncResult.status === "updated") {
      result.summary.updated += 1;
      return;
    }

    if (syncResult.status === "unchanged") {
      result.summary.unchanged += 1;
      return;
    }

    if (syncResult.status === "skipped") {
      result.summary.skipped += 1;
      if (this.isManualSkip(syncResult.reason)) {
        result.summary.manualSkipped += 1;
      }
      return;
    }

    result.summary.errors += 1;
  }

  private isManualSkip(reason?: string): boolean {
    return reason === "late"
      || reason === "leite"
      || reason === "manual_late"
      || reason === "manual"
      || reason === "manual_late_not_overwritten";
  }
}
