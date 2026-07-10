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
});
