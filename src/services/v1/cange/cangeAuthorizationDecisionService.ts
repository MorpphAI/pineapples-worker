import { AvantioApiGateway } from "../../../apiGateways/avantio/getAppointments";
import { classifyCleaningRequirement, isSameDayTurnover } from "../../../domain/scale/bookingClassification";
import {
  classifyCalendarRecord,
  extractCalendarRecordComment,
} from "../../../domain/scale/calendarRecordClassification";
import { AvantioBooking } from "../../../types/avantioTypes";
import { Env } from "../../../types/configTypes";
import { isValidBookingStatus } from "../../../utils/scaleUtils";

const CANGE_AUTHORIZATION_SOURCE = "avantio-cange-status";
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

export type CangeInternalStatus = "out" | "tim";
export type CangeStatus = "OUT" | "OUTIN";
export type CangeSkippedReason =
  | "operational_block"
  | "unknown_calendar_record"
  | "ambiguous_multiple_checkouts"
  | "ambiguous_multiple_checkins";

export type CangeAuthorizationDecisionResult = {
  success: boolean;
  mode: "decision_only";
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
    ambiguousAccommodations: number;
    candidates: number;
    decisions: number;
    skipped: number;
    errors: number;
  };
  decisions: CangeAuthorizationDecision[];
  skipped: CangeAuthorizationSkipped[];
};

export type CangeAuthorizationDecision = {
  accommodationId: string;
  propertyCode: null;
  targetDate: string;
  internalStatus: CangeInternalStatus;
  cangeStatus: CangeStatus;
  idempotencyKey: string;
  sourceKey: string;
  outgoingBookingId: string | null;
  outgoingBookingReference: string | null;
  incomingBookingId: string | null;
  incomingBookingReference: string | null;
  operationalBlock: OperationalBlockPayload | null;
};

export type CangeAuthorizationSkipped = {
  accommodationId: string;
  propertyCode: null;
  reason: CangeSkippedReason;
  operationalBlock: OperationalBlockPayload | null;
};

type AvantioAuthorizationGateway = Pick<AvantioApiGateway, "getCheckins" | "getCheckouts">;
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

export type OperationalBlockPayload = {
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

export function buildCangeAuthorizationKey(date: string, accommodationId: string): string {
  return `${CANGE_AUTHORIZATION_SOURCE}:${date}:${accommodationId}`;
}

export function mapInternalStatusToCangeStatus(status: CangeInternalStatus): CangeStatus {
  return status === "tim" ? "OUTIN" : "OUT";
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

export class CangeAuthorizationDecisionService {
  private readonly avantioApiGateway: AvantioAuthorizationGateway;
  private readonly idempotencyKeyBuilder: IdempotencyKeyBuilder;

  constructor(
    env: Env,
    avantioApiGateway: AvantioAuthorizationGateway = new AvantioApiGateway(env),
    idempotencyKeyBuilder: IdempotencyKeyBuilder = buildCangeAuthorizationKey,
  ) {
    this.avantioApiGateway = avantioApiGateway;
    this.idempotencyKeyBuilder = idempotencyKeyBuilder;
  }

  async getDecisions(date: string): Promise<CangeAuthorizationDecisionResult> {
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

    const result: CangeAuthorizationDecisionResult = {
      success: true,
      mode: "decision_only",
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
        ambiguousAccommodations: 0,
        candidates: 0,
        decisions: 0,
        skipped: 0,
        errors: 0,
      },
      decisions: [],
      skipped: [],
    };
    const emittedKeys = new Set<string>();

    const accommodationIds = Array.from(new Set([
      ...checkoutsByAccommodation.keys(),
      ...operationalCheckoutsByAccommodation.keys(),
      ...operationalCheckinsByAccommodation.keys(),
      ...unknownCheckoutsByAccommodation.keys(),
      ...unknownCheckinsByAccommodation.keys(),
    ])).sort();

    for (const accommodationId of accommodationIds) {
      const checkouts = checkoutsByAccommodation.get(accommodationId) ?? [];
      const checkins = checkinsByAccommodation.get(accommodationId) ?? [];
      const operationalCheckouts = operationalCheckoutsByAccommodation.get(accommodationId) ?? [];
      const operationalCheckins = operationalCheckinsByAccommodation.get(accommodationId) ?? [];
      const unknownCheckouts = unknownCheckoutsByAccommodation.get(accommodationId) ?? [];
      const unknownCheckins = unknownCheckinsByAccommodation.get(accommodationId) ?? [];

      if (unknownCheckouts.length > 0 || unknownCheckins.length > 0) {
        this.addSkipped(result, accommodationId, "unknown_calendar_record", null);
        this.logAccommodationSkip("unknown_calendar_record", [...unknownCheckouts, ...unknownCheckins]);
        continue;
      }

      if (checkouts.length === 0 && operationalCheckouts.length > 0) {
        this.addSkipped(result, accommodationId, "operational_block", this.getSingleOperationalBlockPayload(operationalCheckouts));
        continue;
      }

      if (checkouts.length === 0 && operationalCheckins.length > 0) {
        this.addSkipped(result, accommodationId, "operational_block", this.getSingleOperationalBlockPayload(operationalCheckins));
        continue;
      }

      if (checkouts.length > 1) {
        result.summary.ambiguousAccommodations += 1;
        this.addSkipped(result, accommodationId, "ambiguous_multiple_checkouts", null);
        this.logAccommodationSkip("ambiguous_multiple_checkouts", checkouts);
        continue;
      }

      if (checkins.length > 1) {
        result.summary.ambiguousAccommodations += 1;
        this.addSkipped(result, accommodationId, "ambiguous_multiple_checkins", null);
        this.logAccommodationSkip("ambiguous_multiple_checkins", [...checkouts, ...checkins]);
        continue;
      }

      if (checkouts.length !== 1) continue;

      const bookingOut = checkouts[0];
      const bookingIn = checkins.length === 1 ? checkins[0] : null;
      const operationalBlock = this.getSingleOperationalBlockPayload([
        ...operationalCheckouts,
        ...operationalCheckins,
      ]);
      const cleaningRequirement = classifyCleaningRequirement(bookingOut, bookingIn);
      const internalStatus: CangeInternalStatus = isSameDayTurnover(cleaningRequirement) ? "tim" : "out";
      const idempotencyKey = this.idempotencyKeyBuilder(targetDate, bookingOut.accommodationId);

      if (emittedKeys.has(idempotencyKey)) {
        this.addSkipped(result, bookingOut.accommodationId, "ambiguous_multiple_checkouts", null);
        this.logAccommodationSkip("ambiguous_multiple_checkouts", [bookingOut]);
        continue;
      }
      emittedKeys.add(idempotencyKey);

      result.summary.candidates += 1;
      result.summary.decisions += 1;
      result.decisions.push({
        accommodationId: bookingOut.accommodationId,
        propertyCode: null,
        targetDate,
        internalStatus,
        cangeStatus: mapInternalStatusToCangeStatus(internalStatus),
        idempotencyKey,
        sourceKey: idempotencyKey,
        outgoingBookingId: stringOrNull(bookingOut.id),
        outgoingBookingReference: stringOrNull(bookingOut.reference),
        incomingBookingId: bookingIn ? stringOrNull(bookingIn.id) : null,
        incomingBookingReference: bookingIn ? stringOrNull(bookingIn.reference) : null,
        operationalBlock,
      });
    }

    return result;
  }

  private addSkipped(
    result: CangeAuthorizationDecisionResult,
    accommodationId: string,
    reason: CangeSkippedReason,
    operationalBlock: OperationalBlockPayload | null,
  ): void {
    result.summary.skipped += 1;
    result.skipped.push({
      accommodationId,
      propertyCode: null,
      reason,
      operationalBlock,
    });
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

  private logAccommodationSkip(reason: CangeSkippedReason, bookings: AvantioBooking[]): void {
    for (const booking of bookings) {
      logSafeAuthorizationEvent("accommodation_skipped", buildSafeBookingDiagnostic(booking, { reason }));
      return;
    }
  }
}

function compareBookingsForDeduplication(left: AvantioBooking, right: AvantioBooking): number {
  const leftSignature = getLogicalBookingSignature(left);
  const rightSignature = getLogicalBookingSignature(right);
  const signatureCompare = leftSignature.localeCompare(rightSignature);
  if (signatureCompare !== 0) return signatureCompare;

  return (getStableBookingIdentity(left) ?? "").localeCompare(getStableBookingIdentity(right) ?? "");
}

function buildSafeClassificationSignals(signals: Record<string, unknown>): Record<string, boolean> {
  const safeSignals: Record<string, boolean> = {};

  for (const signalName of ALLOWED_CLASSIFICATION_SIGNAL_NAMES) {
    safeSignals[signalName] = signals[signalName] === true;
  }

  return safeSignals;
}

function logSafeAuthorizationEvent(event: string, diagnostic: SafeBookingDiagnostic): void {
  console.log("[CangeAuthorizationDecision]", {
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
