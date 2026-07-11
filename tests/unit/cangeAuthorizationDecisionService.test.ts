import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCangeAuthorizationKey,
  CangeAuthorizationDecisionService,
  mapInternalStatusToCangeStatus,
} from "../../src/services/v1/cange/cangeAuthorizationDecisionService";
import { AvantioBooking, BookingStatus } from "../../src/types/avantioTypes";
import { Env } from "../../src/types/configTypes";

const DATE = "2026-06-22";

function booking(accommodationId: string, status: string, overrides: Partial<AvantioBooking> = {}): AvantioBooking {
  return {
    id: `${accommodationId}-${status}`,
    id1: `${accommodationId}-id1`,
    reference: `${accommodationId}-ref`,
    creationDate: DATE,
    createdAt: DATE,
    updatedAt: DATE,
    stayDates: {
      arrival: DATE,
      departure: DATE,
    },
    status,
    companyId: "company",
    accommodationId,
    externalData: { reference: `${accommodationId}-external` },
    ...overrides,
  };
}

function productionLikeOperationalBlock(
  accommodationId: string,
  overrides: Partial<AvantioBooking> = {},
): AvantioBooking {
  return booking(accommodationId, BookingStatus.CONFIRMED, {
    status: BookingStatus.CONFIRMED,
    value: "R$ 0,00",
    client: "",
    adults: 1,
    children: 0,
    babies: 0,
    comment: "Dedetização",
    ...overrides,
  });
}

function unknownBooking(accommodationId: string, overrides: Partial<AvantioBooking> = {}): AvantioBooking {
  return booking(accommodationId, BookingStatus.CONFIRMED, {
    amount: 0,
    client: "",
    ...overrides,
  });
}

function buildService(
  checkouts: AvantioBooking[],
  checkins: AvantioBooking[],
  idempotencyKeyBuilder = buildCangeAuthorizationKey,
) {
  return new CangeAuthorizationDecisionService(
    {
      AVANTIO_API_KEY: "",
      AVANTIO_BASE_URL: "",
      API_KEY: "",
      DB: {} as D1Database,
    } satisfies Env,
    {
      getCheckins: async () => checkins,
      getCheckouts: async () => checkouts,
    },
    idempotencyKeyBuilder,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CangeAuthorizationDecisionService", () => {
  it("returns OUT for a real checkout without a real checkin", async () => {
    const result = await buildService([
      booking("apt-1", BookingStatus.CONFIRMED, { guest: { id: "guest-1" } }),
    ], []).getDecisions(DATE);

    expect(result).toMatchObject({
      success: true,
      mode: "decision_only",
      date: DATE,
      summary: {
        rawCheckins: 0,
        rawCheckouts: 1,
        candidates: 1,
        decisions: 1,
        skipped: 0,
        errors: 0,
      },
    });
    expect(result.decisions).toEqual([
      expect.objectContaining({
        accommodationId: "apt-1",
        propertyCode: null,
        targetDate: DATE,
        internalStatus: "out",
        cangeStatus: "OUT",
        idempotencyKey: "avantio-cange-status:2026-06-22:apt-1",
        sourceKey: "avantio-cange-status:2026-06-22:apt-1",
        outgoingBookingId: "apt-1-CONFIRMED",
        incomingBookingId: null,
        operationalBlock: null,
      }),
    ]);
  });

  it("returns OUTIN for a real checkout and real same-day checkin when cleaning rules require turnover", async () => {
    const result = await buildService(
      [booking("apt-1", BookingStatus.CONFIRMED, { id: "checkout-real", guest: { id: "guest-out" } })],
      [booking("apt-1", BookingStatus.PAID, { id: "checkin-real", guest: { id: "guest-in" } })],
    ).getDecisions(DATE);

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]).toMatchObject({
      internalStatus: "tim",
      cangeStatus: "OUTIN",
      outgoingBookingId: "checkout-real",
      incomingBookingId: "checkin-real",
    });
  });

  it("keeps OWNER bookings in owner cleaning rules", async () => {
    const result = await buildService(
      [booking("apt-1", BookingStatus.CONFIRMED, { id: "guest-checkout", guest: { id: "guest-out" } })],
      [booking("apt-1", BookingStatus.OWNER, { id: "owner-checkin" })],
    ).getDecisions(DATE);

    expect(result.decisions[0]).toMatchObject({
      internalStatus: "tim",
      cangeStatus: "OUTIN",
      incomingBookingId: "owner-checkin",
    });
  });

  it("returns OUT when a real checkout is followed only by the production-shaped operational block", async () => {
    const result = await buildService(
      [booking("MQC502", BookingStatus.CONFIRMED, { id: "checkout-real", guest: { id: "guest-out" } })],
      [productionLikeOperationalBlock("MQC502", { id: "block-in", reference: "block-in" })],
    ).getDecisions(DATE);

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]).toMatchObject({
      accommodationId: "MQC502",
      internalStatus: "out",
      cangeStatus: "OUT",
      incomingBookingId: null,
      operationalBlock: {
        id: "block-in",
        reference: "block-in",
        arrival: DATE,
        departure: DATE,
        comment: "Dedetização",
      },
    });
    expect(result.decisions[0].internalStatus).not.toBe("tim");
    expect(result.summary).toMatchObject({
      operationalBlocksSkipped: 1,
      candidates: 1,
      decisions: 1,
    });
  });

  it("does not return OUT when the production-shaped operational block is the only checkout", async () => {
    const result = await buildService(
      [productionLikeOperationalBlock("BR402", { id: "block-out", reference: "block-out" })],
      [],
    ).getDecisions(DATE);

    expect(result.decisions).toHaveLength(0);
    expect(result.skipped).toEqual([
      {
        accommodationId: "BR402",
        propertyCode: null,
        reason: "operational_block",
        operationalBlock: {
          id: "block-out",
          reference: "block-out",
          arrival: DATE,
          departure: DATE,
          comment: "Dedetização",
        },
      },
    ]);
    expect(result.summary).toMatchObject({
      operationalBlocksSkipped: 1,
      candidates: 0,
      decisions: 0,
      skipped: 1,
      errors: 0,
    });
  });

  it("does not create a decision for an operational block beginning without a real checkout", async () => {
    const result = await buildService([], [
      productionLikeOperationalBlock("apt-1", { id: "block-in" }),
    ]).getDecisions(DATE);

    expect(result.decisions).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({
      accommodationId: "apt-1",
      reason: "operational_block",
    });
  });

  it("skips UNKNOWN records conservatively", async () => {
    const result = await buildService(
      [booking("apt-1", BookingStatus.CONFIRMED, { guest: { id: "guest-out" } })],
      [unknownBooking("apt-1", { id: "unknown-in" })],
    ).getDecisions(DATE);

    expect(result.decisions).toHaveLength(0);
    expect(result.skipped).toEqual([
      expect.objectContaining({
        accommodationId: "apt-1",
        reason: "unknown_calendar_record",
        operationalBlock: null,
      }),
    ]);
    expect(result.summary).toMatchObject({
      unknownRecordsSkipped: 1,
      candidates: 0,
      decisions: 0,
      skipped: 1,
      errors: 0,
    });
  });

  it("suppresses duplicated real checkouts and emits one decision", async () => {
    const duplicate = booking("BR402", BookingStatus.CONFIRMED, {
      id: "checkout-real",
      guest: { id: "guest-out" },
    });

    const result = await buildService([duplicate, { ...duplicate }], []).getDecisions(DATE);

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]).toMatchObject({
      accommodationId: "BR402",
      internalStatus: "out",
    });
    expect(result.summary).toMatchObject({
      duplicateCheckoutsSuppressed: 1,
      ambiguousAccommodations: 0,
      candidates: 1,
      decisions: 1,
    });
  });

  it("suppresses duplicated real checkins and emits one OUTIN decision", async () => {
    const duplicateCheckin = booking("apt-1", BookingStatus.PAID, {
      id: "checkin-real",
      guest: { id: "guest-in" },
    });

    const result = await buildService(
      [booking("apt-1", BookingStatus.CONFIRMED, { guest: { id: "guest-out" } })],
      [duplicateCheckin, { ...duplicateCheckin }],
    ).getDecisions(DATE);

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].internalStatus).toBe("tim");
    expect(result.summary.duplicateCheckinsSuppressed).toBe(1);
  });

  it("skips multiple distinct real checkouts as ambiguous", async () => {
    const result = await buildService([
      booking("apt-1", BookingStatus.CONFIRMED, { id: "checkout-a", reference: "checkout-a", guest: { id: "guest-a" } }),
      booking("apt-1", BookingStatus.CONFIRMED, { id: "checkout-b", reference: "checkout-b", guest: { id: "guest-b" } }),
    ], []).getDecisions(DATE);

    expect(result.decisions).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({
      accommodationId: "apt-1",
      reason: "ambiguous_multiple_checkouts",
      operationalBlock: null,
    });
    expect(result.summary).toMatchObject({
      ambiguousAccommodations: 1,
      skipped: 1,
      errors: 0,
    });
  });

  it("skips multiple distinct real checkins as ambiguous", async () => {
    const result = await buildService(
      [booking("apt-1", BookingStatus.CONFIRMED, { guest: { id: "guest-out" } })],
      [
        booking("apt-1", BookingStatus.CONFIRMED, { id: "checkin-a", reference: "checkin-a", guest: { id: "guest-a" } }),
        booking("apt-1", BookingStatus.CONFIRMED, { id: "checkin-b", reference: "checkin-b", guest: { id: "guest-b" } }),
      ],
    ).getDecisions(DATE);

    expect(result.decisions).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({
      accommodationId: "apt-1",
      reason: "ambiguous_multiple_checkins",
    });
    expect(result.summary.ambiguousAccommodations).toBe(1);
  });

  it("ignores date mismatches safely", async () => {
    const result = await buildService(
      [booking("apt-1", BookingStatus.CONFIRMED, {
        stayDates: { arrival: "2026-06-21T15:00:00-03:00", departure: "2026-06-23T11:00:00-03:00" },
        guest: { id: "guest-out" },
      })],
      [booking("apt-1", BookingStatus.PAID, {
        stayDates: { arrival: "2026-06-23T15:00:00-03:00", departure: "2026-06-25" },
        guest: { id: "guest-in" },
      })],
    ).getDecisions(DATE);

    expect(result.decisions).toHaveLength(0);
    expect(result.summary).toMatchObject({
      validCheckins: 1,
      validCheckouts: 1,
      dateMismatchCheckinsSkipped: 1,
      dateMismatchCheckoutsSkipped: 1,
      candidates: 0,
    });
  });

  it("returns decisions in deterministic accommodation order", async () => {
    const result = await buildService([
      booking("apt-b", BookingStatus.CONFIRMED, { guest: { id: "guest-b" } }),
      booking("apt-a", BookingStatus.CONFIRMED, { guest: { id: "guest-a" } }),
    ], []).getDecisions(DATE);

    expect(result.decisions.map((decision) => decision.accommodationId)).toEqual(["apt-a", "apt-b"]);
  });

  it("keeps decisions stable when checkins and checkouts are reversed", async () => {
    const checkouts = [
      booking("apt-b", BookingStatus.CONFIRMED, { guest: { id: "guest-b" } }),
      booking("apt-a", BookingStatus.CONFIRMED, { guest: { id: "guest-a" } }),
    ];
    const checkins = [
      booking("apt-a", BookingStatus.PAID, { id: "checkin-a", guest: { id: "guest-in-a" } }),
      productionLikeOperationalBlock("apt-b", { id: "block-b" }),
    ];

    const forward = await buildService(checkouts, checkins).getDecisions(DATE);
    const reverse = await buildService([...checkouts].reverse(), [...checkins].reverse()).getDecisions(DATE);

    expect(reverse.decisions).toEqual(forward.decisions);
    expect(reverse.skipped).toEqual(forward.skipped);
  });

  it("keeps one decision when the same reservation is repeated many times", async () => {
    const repeatedCheckout = booking("apt-1", BookingStatus.CONFIRMED, {
      id: "checkout-real",
      guest: { id: "guest-out" },
    });

    const result = await buildService(
      Array.from({ length: 5 }, () => ({ ...repeatedCheckout })),
      [],
    ).getDecisions(DATE);

    expect(result.decisions).toHaveLength(1);
    expect(result.summary.duplicateCheckoutsSuppressed).toBe(4);
  });

  it("does not turn OUT into OUTIN when an operational block is added", async () => {
    const result = await buildService(
      [booking("apt-1", BookingStatus.CONFIRMED, { id: "checkout-real", guest: { id: "guest-out" } })],
      [productionLikeOperationalBlock("apt-1", { id: "block-in" })],
    ).getDecisions(DATE);

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]).toMatchObject({
      internalStatus: "out",
      cangeStatus: "OUT",
      incomingBookingId: null,
    });
  });

  it("adding a distinct real booking produces ambiguity instead of arbitrary selection", async () => {
    const result = await buildService(
      [booking("apt-1", BookingStatus.CONFIRMED, { guest: { id: "guest-out" } })],
      [
        booking("apt-1", BookingStatus.PAID, { id: "checkin-a", reference: "checkin-a", guest: { id: "guest-a" } }),
        booking("apt-1", BookingStatus.PAID, { id: "checkin-b", reference: "checkin-b", guest: { id: "guest-b" } }),
      ],
    ).getDecisions(DATE);

    expect(result.decisions).toHaveLength(0);
    expect(result.skipped[0].reason).toBe("ambiguous_multiple_checkins");
  });

  it("never emits more than one decision per accommodation", async () => {
    const result = await buildService([
      booking("apt-1", BookingStatus.CONFIRMED, { id: "checkout-a", reference: "checkout-a", guest: { id: "guest-a" } }),
      booking("apt-1", BookingStatus.CONFIRMED, { id: "checkout-b", reference: "checkout-b", guest: { id: "guest-b" } }),
      booking("apt-2", BookingStatus.CONFIRMED, { id: "checkout-c", guest: { id: "guest-c" } }),
    ], []).getDecisions(DATE);

    const counts = result.decisions.reduce<Record<string, number>>((acc, decision) => {
      acc[decision.accommodationId] = (acc[decision.accommodationId] ?? 0) + 1;
      return acc;
    }, {});

    expect(counts).toEqual({ "apt-2": 1 });
    expect(result.skipped[0].reason).toBe("ambiguous_multiple_checkouts");
  });

  it("does not call fetch or any destination backend while building decisions", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await buildService([
      booking("apt-1", BookingStatus.CONFIRMED, { guest: { id: "guest-out" } }),
    ], []).getDecisions(DATE);

    expect(result.decisions).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("builds deterministic Cange idempotency and source keys by date and accommodation only", async () => {
    expect(buildCangeAuthorizationKey(DATE, "apt-1")).toBe("avantio-cange-status:2026-06-22:apt-1");
    expect(buildCangeAuthorizationKey(DATE, "apt-1")).toBe(buildCangeAuthorizationKey(DATE, "apt-1"));
    expect(buildCangeAuthorizationKey(DATE, "apt-1")).not.toBe(buildCangeAuthorizationKey("2026-06-23", "apt-1"));
    expect(buildCangeAuthorizationKey(DATE, "apt-1")).not.toBe(buildCangeAuthorizationKey(DATE, "apt-2"));
    expect(buildCangeAuthorizationKey(DATE, "apt-1")).not.toContain("booking");
    expect(buildCangeAuthorizationKey(DATE, "apt-1")).not.toContain("Test Guest");
    expect(buildCangeAuthorizationKey(DATE, "apt-1")).not.toContain("test@example.com");

    const result = await buildService([
      booking("apt-1", BookingStatus.CONFIRMED, { id: "booking-out-id", guest: { id: "guest-out" } }),
    ], []).getDecisions(DATE);

    expect(result.decisions[0]).toMatchObject({
      idempotencyKey: "avantio-cange-status:2026-06-22:apt-1",
      sourceKey: "avantio-cange-status:2026-06-22:apt-1",
    });
  });

  it("maps internal statuses to Cange statuses", () => {
    expect(mapInternalStatusToCangeStatus("out")).toBe("OUT");
    expect(mapInternalStatusToCangeStatus("tim")).toBe("OUTIN");
  });

  it("does not require PineOS environment variables to initialize", async () => {
    const service = buildService([
      booking("apt-1", BookingStatus.CONFIRMED, { guest: { id: "guest-out" } }),
    ], []);

    await expect(service.getDecisions(DATE)).resolves.toMatchObject({
      success: true,
      decisions: [expect.objectContaining({ accommodationId: "apt-1" })],
    });
  });

  it("logs only safe diagnostic structure without guest data or comment contents", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const sensitiveBlock = productionLikeOperationalBlock("apt-1", {
      id: "block-sensitive",
      guest: {
        name: "Test Guest",
        email: "test@example.com",
        phone: "+55 21 99999-9999",
        document: "123.456.789-00",
      },
      comment: "Dedetização",
    });
    const duplicateCheckout = booking("apt-2", BookingStatus.CONFIRMED, {
      id: "duplicate",
      guest: {
        name: "Test Guest",
        email: "test@example.com",
        phone: "+55 21 99999-9999",
        document: "123.456.789-00",
      },
    });

    await buildService(
      [duplicateCheckout, { ...duplicateCheckout }],
      [sensitiveBlock, unknownBooking("apt-3", { id: "unknown", note: "Dedetização" })],
    ).getDecisions(DATE);

    const logged = JSON.stringify(logSpy.mock.calls);
    expect(logged).toContain('"hasComment":true');
    expect(logged).toContain('"topLevelFieldNames"');
    expect(logged).not.toContain("Test Guest");
    expect(logged).not.toContain("test@example.com");
    expect(logged).not.toContain("+55 21 99999-9999");
    expect(logged).not.toContain("Dedetização");
    expect(logged).not.toContain("123.456.789-00");
  });
});
