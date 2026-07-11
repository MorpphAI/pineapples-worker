import { AvantioBooking, BookingStatus } from "../../types/avantioTypes";

export type CalendarRecordKind =
  | "GUEST_STAY"
  | "OWNER_STAY"
  | "OPERATIONAL_BLOCK"
  | "UNKNOWN";

export type CalendarRecordClassification = {
  kind: CalendarRecordKind;
  signals: {
    explicitOperationalType: boolean;
    hasGuestIdentity: boolean;
    hasExternalReservationEvidence: boolean;
    hasPositiveAmount: boolean;
    hasZeroAmount: boolean;
    hasRawPositiveOccupancy: boolean;
    hasEffectiveGuestOccupancyEvidence: boolean;
    hasPlaceholderOccupancyPattern: boolean;
    hasComment: boolean;
    usedLegacyFallback: boolean;
  };
};

export type CalendarRecordCommentMetadata = {
  hasComment: boolean;
  comment?: string;
};

const OPERATIONAL_TYPE_MARKERS = new Set([
  "BLOCK",
  "BLOCKED",
  "BLOCKING",
  "OPERATIONALBLOCK",
  "MAINTENANCE",
  "UNAVAILABLE",
  "CLOSED",
  "CLOSURE",
  "TASK",
  "SERVICE",
  "INTERNALBLOCK",
]);

const RESERVATION_TYPE_MARKERS = new Set([
  "BOOKING",
  "RESERVATION",
  "RESERVA",
  "GUEST",
  "HOSPEDE",
  "HOSPEDAGEM",
  "STAY",
]);

const EXTERNAL_RESERVATION_MARKERS = new Set([
  "AIRBNB",
  "BOOKING",
  "BOOKINGCOM",
  "EXPEDIA",
  "VRBO",
  "HOMEAWAY",
  "DIRECT",
  "RESERVATION",
  "RESERVA",
]);

const STRUCTURAL_TYPE_FIELDS = [
  "bookingType",
  "reservationType",
  "type",
  "category",
  "kind",
] as const;

const GUEST_IDENTITY_FIELDS = [
  "guest",
  "guests",
  "client",
  "customer",
  "tenant",
  "holder",
] as const;

const OCCUPANCY_FIELDS = [
  "occupancy",
  "adults",
  "children",
  "babies",
  "guestsNumber",
  "numberOfGuests",
] as const;

const AMOUNT_FIELDS = [
  "price",
  "totalPrice",
  "amount",
  "totalAmount",
  "value",
] as const;

const COMMENT_FIELDS = [
  "comments",
  "comment",
  "notes",
  "note",
  "description",
] as const;

const LEGACY_BOOKING_FIELDS = new Set([
  "id",
  "id1",
  "reference",
  "creationDate",
  "createdAt",
  "updatedAt",
  "stayDates",
  "arrivalTime",
  "departureTime",
  "checkInTime",
  "checkOutTime",
  "expectedArrivalTime",
  "expectedDepartureTime",
  "plannedArrivalTime",
  "plannedDepartureTime",
  "status",
  "companyId",
  "accommodationId",
  "externalData",
]);

export function classifyCalendarRecord(booking: AvantioBooking): CalendarRecordClassification {
  const explicitOperationalType = hasExplicitOperationalType(booking);
  const hasGuestIdentity = hasGuestIdentitySignal(booking);
  const occupancy = getOccupancySignals(booking);
  const amount = getAmountSignals(booking);
  const comment = extractCalendarRecordComment(booking);
  const hasExternalReservationEvidence = hasExternalReservationEvidenceSignal(booking);
  const hasStructuredReservationType = hasExplicitReservationType(booking);
  const hasStrongRealReservationEvidence = hasStrongRealReservationEvidenceSignal({
    hasGuestIdentity,
    hasExternalReservationEvidence,
    hasPositiveAmount: amount.hasPositiveAmount,
    hasExplicitReservationType: hasStructuredReservationType,
  });
  const hasEffectiveGuestOccupancyEvidence = occupancy.hasRawPositiveOccupancy
    && !(
      amount.hasZeroAmount
      && !hasGuestIdentity
      && !hasStrongRealReservationEvidence
      && comment.hasComment
      && occupancy.hasPlaceholderOccupancyPattern
    );
  const hasAdditionalClassificationFields = hasKnownClassificationFields(booking);

  const signals = {
    explicitOperationalType,
    hasGuestIdentity,
    hasExternalReservationEvidence,
    hasPositiveAmount: amount.hasPositiveAmount,
    hasZeroAmount: amount.hasZeroAmount,
    hasRawPositiveOccupancy: occupancy.hasRawPositiveOccupancy,
    hasEffectiveGuestOccupancyEvidence,
    hasPlaceholderOccupancyPattern: occupancy.hasPlaceholderOccupancyPattern,
    hasComment: comment.hasComment,
    usedLegacyFallback: false,
  };

  if (booking.status === BookingStatus.OWNER) {
    return { kind: "OWNER_STAY", signals };
  }

  if (explicitOperationalType) {
    return { kind: "OPERATIONAL_BLOCK", signals };
  }

  if (hasStrongRealReservationEvidence) {
    return { kind: "GUEST_STAY", signals };
  }

  if (
    amount.hasZeroAmount
    && !hasGuestIdentity
    && !hasStrongRealReservationEvidence
    && comment.hasComment
    && (
      occupancy.hasZeroOccupancy
      || occupancy.hasPlaceholderOccupancyPattern
      || !occupancy.hasOccupancySignal
    )
  ) {
    return { kind: "OPERATIONAL_BLOCK", signals };
  }

  if (hasEffectiveGuestOccupancyEvidence) {
    return { kind: "GUEST_STAY", signals };
  }

  if (!hasAdditionalClassificationFields && hasOnlyLegacyFields(booking)) {
    return {
      kind: "GUEST_STAY",
      signals: {
        ...signals,
        usedLegacyFallback: true,
      },
    };
  }

  return { kind: "UNKNOWN", signals };
}

export function extractCalendarRecordComment(booking: AvantioBooking): CalendarRecordCommentMetadata {
  const values = COMMENT_FIELDS.flatMap((field) => collectStrings(booking[field]));
  const comment = values.find((value) => value.length > 0);
  return comment ? { hasComment: true, comment } : { hasComment: false };
}

function hasExplicitOperationalType(booking: AvantioBooking): boolean {
  const values: unknown[] = [];
  for (const field of STRUCTURAL_TYPE_FIELDS) values.push(booking[field]);
  values.push(booking.externalData?.type, booking.externalData?.category, booking.externalData?.kind);

  return values
    .flatMap((value) => collectMarkerValues(value))
    .some((value) => {
      const normalized = normalizeMarker(value);
      if (!normalized) return false;
      for (const marker of OPERATIONAL_TYPE_MARKERS) {
        if (normalized.includes(marker)) return true;
      }
      return false;
    });
}

function hasExplicitReservationType(booking: AvantioBooking): boolean {
  const values: unknown[] = [];
  for (const field of STRUCTURAL_TYPE_FIELDS) values.push(booking[field]);
  values.push(booking.externalData?.type, booking.externalData?.category, booking.externalData?.kind);

  return values
    .flatMap((value) => collectMarkerValues(value))
    .some((value) => {
      const normalized = normalizeMarker(value);
      if (!normalized) return false;
      if (isOperationalMarker(normalized)) return false;
      return isReservationMarker(normalized);
    });
}

function hasExternalReservationEvidenceSignal(booking: AvantioBooking): boolean {
  const values = [
    booking.externalData?.reference,
    booking.source,
    booking.channel,
    booking.externalData?.source,
    booking.externalData?.channel,
  ];

  return values
    .flatMap((value) => collectMarkerValues(value))
    .some((value) => {
      const normalized = normalizeMarker(value);
      if (!normalized) return false;
      if (isGenericInternalReference(normalized, booking)) return false;
      return isReservationMarker(normalized);
    });
}

function hasStrongRealReservationEvidenceSignal(input: {
  hasGuestIdentity: boolean;
  hasExternalReservationEvidence: boolean;
  hasPositiveAmount: boolean;
  hasExplicitReservationType: boolean;
}): boolean {
  return input.hasGuestIdentity
    || input.hasExternalReservationEvidence
    || input.hasPositiveAmount
    || input.hasExplicitReservationType;
}

function hasGuestIdentitySignal(booking: AvantioBooking): boolean {
  return GUEST_IDENTITY_FIELDS.some((field) => hasIdentityValue(booking[field]));
}

function hasIdentityValue(value: unknown): boolean {
  if (isNonEmptyString(value)) return true;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (Array.isArray(value)) return value.some((item) => hasIdentityValue(item));
  if (isRecord(value)) {
    return Object.values(value).some((item) => {
      if (isNonEmptyString(item)) return true;
      if (typeof item === "number") return Number.isFinite(item) && item > 0;
      return false;
    });
  }
  return false;
}

function getOccupancySignals(booking: AvantioBooking): {
  hasOccupancySignal: boolean;
  hasRawPositiveOccupancy: boolean;
  hasZeroOccupancy: boolean;
  hasPlaceholderOccupancyPattern: boolean;
} {
  const values = OCCUPANCY_FIELDS.flatMap((field) => collectNumbers(booking[field]));
  if (values.length === 0) {
    return {
      hasOccupancySignal: false,
      hasRawPositiveOccupancy: false,
      hasZeroOccupancy: false,
      hasPlaceholderOccupancyPattern: false,
    };
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    hasOccupancySignal: true,
    hasRawPositiveOccupancy: values.some((value) => value > 0),
    hasZeroOccupancy: total === 0,
    hasPlaceholderOccupancyPattern: hasPlaceholderOccupancyPattern(booking),
  };
}

function hasPlaceholderOccupancyPattern(booking: AvantioBooking): boolean {
  const adultValues = collectNumbers(booking.adults);
  if (adultValues.length === 0 || adultValues.some((value) => value !== 1)) return false;

  const childValues = collectNumbers(booking.children);
  const babyValues = collectNumbers(booking.babies);
  const otherOccupancyValues = [
    ...collectNumbers(booking.occupancy),
    ...collectNumbers(booking.guestsNumber),
    ...collectNumbers(booking.numberOfGuests),
  ];

  return allAbsentOrZero(childValues)
    && allAbsentOrZero(babyValues)
    && allAbsentOrZero(otherOccupancyValues);
}

function getAmountSignals(booking: AvantioBooking): {
  hasPositiveAmount: boolean;
  hasZeroAmount: boolean;
} {
  const values = AMOUNT_FIELDS.flatMap((field) => collectMoneyValues(booking[field]));
  return {
    hasPositiveAmount: values.some((value) => value > 0),
    hasZeroAmount: values.some((value) => value === 0),
  };
}

function collectMoneyValues(value: unknown): number[] {
  if (typeof value === "number") return Number.isFinite(value) ? [value] : [];
  if (typeof value === "string") {
    const parsed = parseMoneyString(value);
    return parsed === null ? [] : [parsed];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectMoneyValues(item));
  if (isRecord(value)) return Object.values(value).flatMap((item) => collectMoneyValues(item));
  return [];
}

function collectNumbers(value: unknown): number[] {
  if (typeof value === "number") return Number.isFinite(value) ? [value] : [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    const parsed = Number(trimmed.replace(",", "."));
    return Number.isFinite(parsed) ? [parsed] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectNumbers(item));
  if (isRecord(value)) return Object.values(value).flatMap((item) => collectNumbers(item));
  return [];
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => collectStrings(item));
  if (isRecord(value)) return Object.values(value).flatMap((item) => collectStrings(item));
  return [];
}

function collectMarkerValues(value: unknown): string[] {
  if (
    typeof value !== "string"
    && typeof value !== "number"
    && typeof value !== "boolean"
  ) {
    return [];
  }

  const normalized = normalizeMarker(value);
  return normalized ? [String(value)] : [];
}

function parseMoneyString(value: string): number | null {
  const cleaned = value
    .trim()
    .replace(/[^\d,.-]/g, "");

  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const decimalSeparator = lastComma > lastDot ? "," : ".";
  const normalized = cleaned
    .replace(new RegExp(`\\${decimalSeparator === "," ? "." : ","}`, "g"), "")
    .replace(decimalSeparator, ".");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

function hasKnownClassificationFields(booking: AvantioBooking): boolean {
  const fields = [
    ...STRUCTURAL_TYPE_FIELDS,
    ...GUEST_IDENTITY_FIELDS,
    ...OCCUPANCY_FIELDS,
    ...AMOUNT_FIELDS,
    ...COMMENT_FIELDS,
    "source",
    "channel",
  ];

  return fields.some((field) => booking[field] !== undefined)
    || booking.externalData?.type !== undefined
    || booking.externalData?.category !== undefined
    || booking.externalData?.kind !== undefined;
}

function hasOnlyLegacyFields(booking: AvantioBooking): boolean {
  return Object.keys(booking).every((key) => LEGACY_BOOKING_FIELDS.has(key));
}

function normalizeMarker(value: unknown): string {
  if (
    typeof value !== "string"
    && typeof value !== "number"
    && typeof value !== "boolean"
  ) {
    return "";
  }

  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[\s_-]/g, "");
}

function isOperationalMarker(normalizedValue: string): boolean {
  for (const marker of OPERATIONAL_TYPE_MARKERS) {
    if (normalizedValue.includes(marker)) return true;
  }
  return false;
}

function isReservationMarker(normalizedValue: string): boolean {
  for (const marker of EXTERNAL_RESERVATION_MARKERS) {
    if (normalizedValue.includes(marker)) return true;
  }
  for (const marker of RESERVATION_TYPE_MARKERS) {
    if (normalizedValue.includes(marker)) return true;
  }
  return false;
}

function isGenericInternalReference(normalizedValue: string, booking: AvantioBooking): boolean {
  const genericValues = [
    booking.id,
    booking.id1,
    booking.reference,
    "external-ref",
  ].map((value) => normalizeMarker(value));

  return genericValues.includes(normalizedValue)
    || normalizedValue.endsWith("EXTERNAL");
}

function allAbsentOrZero(values: number[]): boolean {
  return values.length === 0 || values.every((value) => value === 0);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
