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
    hasPositiveOccupancy: boolean;
    hasZeroOccupancy: boolean;
    hasPositiveAmount: boolean;
    hasZeroAmount: boolean;
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
  const hasAdditionalClassificationFields = hasKnownClassificationFields(booking);

  const signals = {
    explicitOperationalType,
    hasGuestIdentity,
    hasPositiveOccupancy: occupancy.hasPositiveOccupancy,
    hasZeroOccupancy: occupancy.hasZeroOccupancy,
    hasPositiveAmount: amount.hasPositiveAmount,
    hasZeroAmount: amount.hasZeroAmount,
    hasComment: comment.hasComment,
    usedLegacyFallback: false,
  };

  if (booking.status === BookingStatus.OWNER) {
    return { kind: "OWNER_STAY", signals };
  }

  if (explicitOperationalType) {
    return { kind: "OPERATIONAL_BLOCK", signals };
  }

  if (
    amount.hasZeroAmount
    && !hasGuestIdentity
    && (occupancy.hasZeroOccupancy || !occupancy.hasOccupancySignal)
    && comment.hasComment
  ) {
    return { kind: "OPERATIONAL_BLOCK", signals };
  }

  if (hasGuestIdentity || occupancy.hasPositiveOccupancy || amount.hasPositiveAmount) {
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
    .flatMap((value) => collectStrings(value))
    .some((value) => {
      const normalized = normalizeMarker(value);
      for (const marker of OPERATIONAL_TYPE_MARKERS) {
        if (normalized.includes(marker)) return true;
      }
      return false;
    });
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
  hasPositiveOccupancy: boolean;
  hasZeroOccupancy: boolean;
} {
  const values = OCCUPANCY_FIELDS.flatMap((field) => collectNumbers(booking[field]));
  if (values.length === 0) {
    return {
      hasOccupancySignal: false,
      hasPositiveOccupancy: false,
      hasZeroOccupancy: false,
    };
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    hasOccupancySignal: true,
    hasPositiveOccupancy: values.some((value) => value > 0),
    hasZeroOccupancy: total === 0,
  };
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

function normalizeMarker(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[\s_-]/g, "");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
