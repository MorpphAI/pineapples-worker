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
    expect(result.signals.hasPositiveOccupancy).toBe(true);
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
      hasZeroOccupancy: true,
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
});
