import { describe, expect, it } from "vitest";
import { classifyCalendarRecord } from "../../src/domain/scale/calendarRecordClassification";
import { AvantioBooking, BookingStatus } from "../../src/types/avantioTypes";

const DATE = "2026-06-22";

function booking(status: string, overrides: Partial<AvantioBooking> = {}): AvantioBooking {
  return {
    id: "booking-1",
    id1: "booking-id1",
    reference: "booking-ref",
    creationDate: DATE,
    createdAt: DATE,
    updatedAt: DATE,
    stayDates: {
      arrival: DATE,
      departure: DATE,
    },
    status,
    companyId: "company",
    accommodationId: "apt-1",
    externalData: { reference: "external-ref" },
    ...overrides,
  };
}

function sparseBooking(status: string, overrides: Record<string, unknown> = {}): AvantioBooking {
  return {
    id: "booking-1",
    creationDate: DATE,
    createdAt: DATE,
    updatedAt: DATE,
    stayDates: {
      arrival: DATE,
      departure: DATE,
    },
    status,
    companyId: "company",
    accommodationId: "apt-1",
    ...overrides,
  } as AvantioBooking;
}

function productionLikeOperationalBlock(overrides: Partial<AvantioBooking> = {}): Partial<AvantioBooking> {
  return {
    value: "R$ 0,00",
    client: "",
    adults: 1,
    children: 0,
    babies: 0,
    comment: "Dedetização",
    ...overrides,
  };
}

describe("classifyCalendarRecord", () => {
  it("keeps OWNER with zero amount and comment as OWNER_STAY", () => {
    const result = classifyCalendarRecord(booking(BookingStatus.OWNER, {
      amount: 0,
      adults: 0,
      comment: "maintenance note",
    }));

    expect(result.kind).toBe("OWNER_STAY");
  });

  it("keeps a zero-amount reservation with guest identity as GUEST_STAY", () => {
    const result = classifyCalendarRecord(booking(BookingStatus.CONFIRMED, {
      amount: 0,
      guest: { name: "Guest Name" },
      comment: "note",
    }));

    expect(result.kind).toBe("GUEST_STAY");
    expect(result.signals.hasGuestIdentity).toBe(true);
  });

  it("keeps a reservation with positive occupancy as GUEST_STAY", () => {
    const result = classifyCalendarRecord(booking(BookingStatus.CONFIRMED, {
      adults: 1,
    }));

    expect(result.kind).toBe("GUEST_STAY");
    expect(result.signals.hasRawPositiveOccupancy).toBe(true);
    expect(result.signals.hasEffectiveGuestOccupancyEvidence).toBe(true);
  });

  it("classifies explicit MAINTENANCE type as OPERATIONAL_BLOCK", () => {
    const result = classifyCalendarRecord(booking(BookingStatus.CONFIRMED, {
      bookingType: "MAINTENANCE",
    }));

    expect(result.kind).toBe("OPERATIONAL_BLOCK");
    expect(result.signals.explicitOperationalType).toBe(true);
  });

  it("classifies explicit BLOCKED type as OPERATIONAL_BLOCK", () => {
    const result = classifyCalendarRecord(booking(BookingStatus.CONFIRMED, {
      externalData: { reference: "external-ref", type: "blocked" },
    }));

    expect(result.kind).toBe("OPERATIONAL_BLOCK");
    expect(result.signals.explicitOperationalType).toBe(true);
  });

  it("classifies zero amount, no guest, zero occupancy and comment as OPERATIONAL_BLOCK", () => {
    const result = classifyCalendarRecord(booking(BookingStatus.CONFIRMED, {
      amount: "R$ 0,00",
      adults: 0,
      children: 0,
      babies: 0,
      comment: "service note",
    }));

    expect(result.kind).toBe("OPERATIONAL_BLOCK");
    expect(result.signals).toMatchObject({
      hasZeroAmount: true,
      hasRawPositiveOccupancy: false,
      hasEffectiveGuestOccupancyEvidence: false,
      hasComment: true,
    });
  });

  it("does not classify an isolated comment as operational block", () => {
    const result = classifyCalendarRecord(booking(BookingStatus.CONFIRMED, {
      comment: "service note",
    }));

    expect(result.kind).not.toBe("OPERATIONAL_BLOCK");
  });

  it("does not classify an isolated zero amount as operational block", () => {
    const result = classifyCalendarRecord(booking(BookingStatus.CONFIRMED, {
      amount: 0,
    }));

    expect(result.kind).not.toBe("OPERATIONAL_BLOCK");
  });

  it("keeps a minimal legacy valid booking as GUEST_STAY", () => {
    const result = classifyCalendarRecord(booking(BookingStatus.CONFIRMED));

    expect(result.kind).toBe("GUEST_STAY");
    expect(result.signals.usedLegacyFallback).toBe(true);
  });

  it("classifies production-like zero-value calendar block with adults 1 and empty client as OPERATIONAL_BLOCK", () => {
    const result = classifyCalendarRecord(booking(
      BookingStatus.CONFIRMED,
      productionLikeOperationalBlock(),
    ));

    expect(result.kind).toBe("OPERATIONAL_BLOCK");
    expect(result.signals).toMatchObject({
      hasZeroAmount: true,
      hasGuestIdentity: false,
      hasComment: true,
    });
  });

  it("keeps OWNER production-like zero-value block signals as OWNER_STAY", () => {
    const result = classifyCalendarRecord(booking(
      BookingStatus.OWNER,
      productionLikeOperationalBlock(),
    ));

    expect(result.kind).toBe("OWNER_STAY");
  });

  it("keeps a real zero-value guest with adults 1 as GUEST_STAY", () => {
    const result = classifyCalendarRecord(booking(BookingStatus.CONFIRMED, {
      ...productionLikeOperationalBlock(),
      client: "Fictional Guest",
    }));

    expect(result.kind).toBe("GUEST_STAY");
    expect(result.signals.hasGuestIdentity).toBe(true);
  });

  it("keeps a zero-value booking with external reservation evidence as GUEST_STAY", () => {
    const result = classifyCalendarRecord(booking(BookingStatus.CONFIRMED, {
      value: "R$ 0,00",
      adults: 1,
      externalData: { reference: "AIRBNB-123" },
    }));

    expect(result.kind).toBe("GUEST_STAY");
    expect(result.signals).toMatchObject({
      hasExternalReservationEvidence: true,
      hasZeroAmount: true,
      hasRawPositiveOccupancy: true,
    });
  });

  it("does not classify a normal commented booking as operational block", () => {
    const result = classifyCalendarRecord(booking(BookingStatus.CONFIRMED, {
      value: "R$ 100,00",
      client: "Fictional Guest",
      adults: 1,
      children: 0,
      babies: 0,
      comment: "Late arrival",
    }));

    expect(result.kind).toBe("GUEST_STAY");
    expect(result.kind).not.toBe("OPERATIONAL_BLOCK");
  });

  it("does not throw when optional references are missing", () => {
    expect(() => classifyCalendarRecord(sparseBooking(BookingStatus.CONFIRMED))).not.toThrow();

    const result = classifyCalendarRecord(sparseBooking(BookingStatus.CONFIRMED));
    expect(result.kind).toBe("GUEST_STAY");
  });

  it("does not throw when only externalData.reference is present", () => {
    expect(() => classifyCalendarRecord(sparseBooking(BookingStatus.CONFIRMED, {
      externalData: { reference: "AIRBNB-123" },
    }))).not.toThrow();

    const result = classifyCalendarRecord(sparseBooking(BookingStatus.CONFIRMED, {
      externalData: { reference: "AIRBNB-123" },
    }));
    expect(result.kind).toBe("GUEST_STAY");
    expect(result.signals.hasExternalReservationEvidence).toBe(true);
  });

  it("does not throw when structural fields are undefined", () => {
    const result = classifyCalendarRecord(sparseBooking(BookingStatus.CONFIRMED, {
      bookingType: undefined,
      reservationType: undefined,
      type: undefined,
      category: undefined,
      kind: undefined,
      source: undefined,
      channel: undefined,
    }));

    expect(result.kind).toBe("UNKNOWN");
  });

  it("does not throw when optional metadata fields are null", () => {
    const result = classifyCalendarRecord(sparseBooking(BookingStatus.CONFIRMED, {
      id1: null,
      reference: null,
      externalData: {
        reference: null,
        type: null,
        category: null,
        kind: null,
        source: null,
        channel: null,
      },
      bookingType: null,
      reservationType: null,
      type: null,
      category: null,
      kind: null,
      source: null,
      channel: null,
    }));

    expect(result.kind).toBe("UNKNOWN");
  });

  it("normalizes non-string primitive marker fields safely", () => {
    const result = classifyCalendarRecord(sparseBooking(BookingStatus.CONFIRMED, {
      bookingType: 123,
      reservationType: false,
      type: true,
      category: 456,
      kind: false,
      source: 789,
      channel: true,
    }));

    expect(result.kind).toBe("UNKNOWN");
  });

  it("ignores object and array values in generic marker fields", () => {
    const result = classifyCalendarRecord(sparseBooking(BookingStatus.CONFIRMED, {
      bookingType: { label: "MAINTENANCE" },
      reservationType: ["AIRBNB"],
      type: { value: "BLOCKED" },
      category: ["RESERVATION"],
      kind: { text: "GUEST" },
      source: ["BOOKING"],
      channel: { name: "AIRBNB" },
      externalData: {
        reference: { value: "AIRBNB-123" },
        type: { label: "BLOCKED" },
        category: ["UNAVAILABLE"],
        kind: { value: "MAINTENANCE" },
      },
    }));

    expect(result.kind).toBe("UNKNOWN");
    expect(result.signals.explicitOperationalType).toBe(false);
    expect(result.signals.hasExternalReservationEvidence).toBe(false);
  });

  it("keeps sparse production-like operational block as OPERATIONAL_BLOCK", () => {
    const result = classifyCalendarRecord(sparseBooking(BookingStatus.CONFIRMED, {
      ...productionLikeOperationalBlock(),
      externalData: undefined,
      id1: undefined,
      reference: undefined,
    }));

    expect(result.kind).toBe("OPERATIONAL_BLOCK");
  });

  it("keeps sparse zero-value guest as GUEST_STAY", () => {
    const result = classifyCalendarRecord(sparseBooking(BookingStatus.CONFIRMED, {
      value: "R$ 0,00",
      guest: { id: "guest-123", name: "Fictional Guest" },
      adults: 1,
      externalData: undefined,
      id1: undefined,
      reference: undefined,
    }));

    expect(result.kind).toBe("GUEST_STAY");
  });

  it("keeps sparse OWNER metadata as OWNER_STAY", () => {
    const result = classifyCalendarRecord(sparseBooking(BookingStatus.OWNER, {
      value: "R$ 0,00",
      adults: 1,
      comment: "owner use",
      id1: undefined,
      reference: undefined,
      externalData: undefined,
    }));

    expect(result.kind).toBe("OWNER_STAY");
  });
});
