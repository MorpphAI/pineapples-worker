import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildIdempotencyKey,
  SyncAuthorizationStatusService,
} from "../../src/services/v1/kanban/syncAuthorizationStatusService";
import {
  AuthorizationSyncPayload,
  AuthorizationSyncResult,
  PineOSKanbanAuthorizationClient,
} from "../../src/repositories/kanban/pineosKanbanAuthorizationClient";
import { AvantioBooking, BookingStatus } from "../../src/types/avantioTypes";
import { todayInSaoPaulo } from "../../src/controllers/v1/kanban/syncAuthorizationStatus/syncAuthorizationStatus";

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

function productionLikeOperationalBlock(accommodationId: string, overrides: Partial<AvantioBooking> = {}): AvantioBooking {
  return booking(accommodationId, BookingStatus.CONFIRMED, {
    value: "R$ 0,00",
    client: "",
    adults: 1,
    children: 0,
    babies: 0,
    comment: "Dedetização",
    ...overrides,
  });
}

function buildService(
  checkouts: AvantioBooking[],
  checkins: AvantioBooking[],
  syncAuthorization: (input: AuthorizationSyncPayload) => Promise<AuthorizationSyncResult>,
  idempotencyKeyBuilder: (targetDate: string, accommodationId: string) => string = buildIdempotencyKey,
) {
  return new SyncAuthorizationStatusService(
    {} as any,
    {
      getCheckins: async () => checkins,
      getCheckouts: async () => checkouts,
    },
    { syncAuthorization },
    idempotencyKeyBuilder,
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SyncAuthorizationStatusService", () => {
  it("sends out for a valid checkout without same-day checkin", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const service = buildService(
      [booking("apt-1", BookingStatus.CONFIRMED)],
      [],
      async (input) => {
        calls.push(input);
        return { status: "updated", card_id: "card-1", new_status: input.authorizationStatus };
      },
    );

    const result = await service.sync(DATE);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      accommodationId: "apt-1",
      propertyCode: "apt-1-external",
      targetDate: DATE,
      authorizationStatus: "out",
      idempotencyKey: "avantio-status-sync:2026-06-22:apt-1",
    });
    expect(calls[0].payload).toMatchObject({
      idempotency_key: "avantio-status-sync:2026-06-22:apt-1",
      booking_out_id: "apt-1-CONFIRMED",
      booking_in_id: null,
      classification: "GUEST_CHECKOUT_ONLY",
      source: "avantio-status-sync",
    });
    expect(result.summary.updated).toBe(1);
  });

  it("sends tim for a valid checkout with same-day valid checkin for the same accommodation", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const service = buildService(
      [booking("apt-1", BookingStatus.CONFIRMED)],
      [booking("apt-1", BookingStatus.PAID)],
      async (input) => {
        calls.push(input);
        return { status: "unchanged", previous_status: "tim", new_status: "tim" };
      },
    );

    const result = await service.sync(DATE);

    expect(calls[0].authorizationStatus).toBe("tim");
    expect(calls[0].payload).toMatchObject({
      booking_in_id: "apt-1-PAID",
      classification: "GUEST_TURNOVER",
    });
    expect(result.summary.unchanged).toBe(1);
  });

  it("ignores invalid booking statuses", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const service = buildService(
      [booking("apt-1", "CANCELLED"), booking("apt-2", BookingStatus.UNPAID)],
      [booking("apt-2", "CANCELLED")],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
    );

    const result = await service.sync(DATE);

    expect(calls).toHaveLength(1);
    expect(calls[0].accommodationId).toBe("apt-2");
    expect(calls[0].authorizationStatus).toBe("out");
    expect(result.summary).toMatchObject({
      rawCheckins: 1,
      rawCheckouts: 2,
      validCheckins: 0,
      validCheckouts: 1,
      candidates: 1,
    });
  });

  it("counts skipped manual_late_not_overwritten as skipped and manualSkipped", async () => {
    const service = buildService(
      [booking("apt-1", BookingStatus.CONFIRMED)],
      [],
      async () => ({ status: "skipped", reason: "manual_late_not_overwritten" }),
    );

    const result = await service.sync(DATE);

    expect(result.summary.skipped).toBe(1);
    expect(result.summary.manualSkipped).toBe(1);
    expect(result.summary.errors).toBe(0);
  });

  it("continues when one PineOS backend sync call fails", async () => {
    const service = buildService(
      [booking("apt-1", BookingStatus.CONFIRMED), booking("apt-2", BookingStatus.CONFIRMED)],
      [],
      async (input) => {
        if (input.accommodationId === "apt-1") throw new Error("RPC down");
        return { status: "updated" };
      },
    );

    const result = await service.sync(DATE);

    expect(result.success).toBe(false);
    expect(result.summary.errors).toBe(1);
    expect(result.summary.updated).toBe(1);
    expect(result.results.map((item) => item.accommodationId)).toEqual(["apt-1", "apt-2"]);
  });

  it("suppresses duplicate checkouts with the same stable id and sends one out", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const duplicate = booking("apt-1", BookingStatus.CONFIRMED, { id: "checkout-1" });
    const service = buildService(
      [duplicate, { ...duplicate }],
      [],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
    );

    const result = await service.sync(DATE);

    expect(calls).toHaveLength(1);
    expect(calls[0].authorizationStatus).toBe("out");
    expect(result.summary).toMatchObject({
      duplicateCheckoutsSuppressed: 1,
      candidates: 1,
      ambiguousAccommodations: 0,
    });
  });

  it("suppresses duplicate checkouts with the same logical signature and sends one out", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const service = buildService(
      [
        booking("apt-1", BookingStatus.CONFIRMED, { id: "checkout-1", reference: "same-ref" }),
        booking("apt-1", BookingStatus.CONFIRMED, { id: "checkout-2", reference: "same-ref" }),
      ],
      [],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
    );

    const result = await service.sync(DATE);

    expect(calls).toHaveLength(1);
    expect(result.summary.duplicateCheckoutsSuppressed).toBe(1);
  });

  it("skips an accommodation with multiple distinct checkouts", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const service = buildService(
      [
        booking("apt-1", BookingStatus.CONFIRMED, { id: "checkout-1", reference: "ref-1" }),
        booking("apt-1", BookingStatus.CONFIRMED, { id: "checkout-2", reference: "ref-2" }),
      ],
      [],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
    );

    const result = await service.sync(DATE);

    expect(calls).toHaveLength(0);
    expect(result.summary).toMatchObject({
      candidates: 0,
      ambiguousAccommodations: 1,
      skipped: 1,
    });
    expect(result.results).toEqual([
      expect.objectContaining({
        accommodationId: "apt-1",
        computedStatus: null,
        rpcStatus: "skipped",
        reason: "ambiguous_multiple_checkouts",
      }),
    ]);
  });

  it("suppresses duplicate checkins and sends one turnover decision", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const duplicateCheckin = booking("apt-1", BookingStatus.PAID, { id: "checkin-1" });
    const service = buildService(
      [booking("apt-1", BookingStatus.CONFIRMED)],
      [duplicateCheckin, { ...duplicateCheckin }],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
    );

    const result = await service.sync(DATE);

    expect(calls).toHaveLength(1);
    expect(calls[0].authorizationStatus).toBe("tim");
    expect(result.summary.duplicateCheckinsSuppressed).toBe(1);
  });

  it("skips an accommodation with multiple distinct checkins", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const service = buildService(
      [booking("apt-1", BookingStatus.CONFIRMED)],
      [
        booking("apt-1", BookingStatus.PAID, { id: "checkin-1", reference: "ref-1" }),
        booking("apt-1", BookingStatus.PAID, { id: "checkin-2", reference: "ref-2" }),
      ],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
    );

    const result = await service.sync(DATE);

    expect(calls).toHaveLength(0);
    expect(result.summary).toMatchObject({
      candidates: 0,
      ambiguousAccommodations: 1,
      skipped: 1,
    });
    expect(result.results[0]).toMatchObject({
      accommodationId: "apt-1",
      computedStatus: null,
      rpcStatus: "skipped",
      reason: "ambiguous_multiple_checkins",
    });
  });

  it("ignores a checkout whose departure date does not match the target date", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const service = buildService(
      [booking("apt-1", BookingStatus.CONFIRMED, {
        stayDates: { arrival: DATE, departure: "2026-06-23T10:00:00-03:00" },
      })],
      [],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
    );

    const result = await service.sync(DATE);

    expect(calls).toHaveLength(0);
    expect(result.summary).toMatchObject({
      validCheckouts: 1,
      dateMismatchCheckoutsSkipped: 1,
      candidates: 0,
    });
  });

  it("ignores a checkin whose arrival date does not match the target date", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const service = buildService(
      [booking("apt-1", BookingStatus.CONFIRMED)],
      [booking("apt-1", BookingStatus.PAID, {
        stayDates: { arrival: "2026-06-23T15:00:00-03:00", departure: "2026-06-25" },
      })],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
    );

    const result = await service.sync(DATE);

    expect(calls).toHaveLength(1);
    expect(calls[0].authorizationStatus).toBe("out");
    expect(calls[0].payload).toMatchObject({
      booking_in_id: null,
      classification: "GUEST_CHECKOUT_ONLY",
    });
    expect(result.summary).toMatchObject({
      validCheckins: 1,
      dateMismatchCheckinsSkipped: 1,
      candidates: 1,
    });
  });

  it("processes different accommodations independently", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const service = buildService(
      [booking("apt-2", BookingStatus.CONFIRMED), booking("apt-1", BookingStatus.CONFIRMED)],
      [booking("apt-1", BookingStatus.PAID)],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
    );

    const result = await service.sync(DATE);

    expect(calls).toHaveLength(2);
    expect(calls.map((call) => [call.accommodationId, call.authorizationStatus])).toEqual([
      ["apt-1", "tim"],
      ["apt-2", "out"],
    ]);
    expect(calls.map((call) => call.idempotencyKey)).toEqual([
      "avantio-status-sync:2026-06-22:apt-1",
      "avantio-status-sync:2026-06-22:apt-2",
    ]);
    expect(result.summary.candidates).toBe(2);
  });

  it("builds deterministic idempotency keys by date and accommodation", () => {
    expect(buildIdempotencyKey(DATE, "apt-1")).toBe("avantio-status-sync:2026-06-22:apt-1");
    expect(buildIdempotencyKey(DATE, "apt-1")).toBe(buildIdempotencyKey(DATE, "apt-1"));
    expect(buildIdempotencyKey(DATE, "apt-1")).not.toBe(buildIdempotencyKey("2026-06-23", "apt-1"));
    expect(buildIdempotencyKey(DATE, "apt-1")).not.toBe(buildIdempotencyKey(DATE, "apt-2"));
    expect(buildIdempotencyKey(DATE, "apt-1")).not.toContain("Test Guest");
    expect(buildIdempotencyKey(DATE, "apt-1")).not.toContain("test@example.com");
    expect(buildIdempotencyKey(DATE, "apt-1")).not.toContain("+55 21 99999-9999");
    expect(buildIdempotencyKey(DATE, "apt-1")).not.toContain("123.456.789-00");
  });

  it("uses the normalized target date when building the idempotency key", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const service = buildService(
      [booking("apt-1", BookingStatus.CONFIRMED, {
        stayDates: {
          arrival: "2026-06-21T15:00:00-03:00",
          departure: "2026-06-22T11:00:00-03:00",
        },
      })],
      [],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
    );

    await service.sync("2026-06-22T09:00:00-03:00");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      accommodationId: "apt-1",
      targetDate: "2026-06-22T09:00:00-03:00",
      idempotencyKey: "avantio-status-sync:2026-06-22:apt-1",
    });
    expect(calls[0].payload).toMatchObject({
      date: "2026-06-22T09:00:00-03:00",
      idempotency_key: "avantio-status-sync:2026-06-22:apt-1",
    });
  });

  it("suppresses a duplicate idempotency key within the same execution before a second PineOS call", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const duplicateKey = "avantio-status-sync:2026-06-22:forced-collision";
    const service = buildService(
      [booking("apt-1", BookingStatus.CONFIRMED), booking("apt-2", BookingStatus.CONFIRMED)],
      [],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
      () => duplicateKey,
    );

    const result = await service.sync(DATE);

    expect(calls).toHaveLength(1);
    expect(calls[0].idempotencyKey).toBe(duplicateKey);
    expect(calls[0].payload).toMatchObject({
      idempotency_key: duplicateKey,
      accommodation_id: "apt-1",
    });
    expect(result.results).toEqual([
      expect.objectContaining({
        accommodationId: "apt-1",
        rpcStatus: "updated",
      }),
      expect.objectContaining({
        accommodationId: "apt-2",
        computedStatus: "out",
        rpcStatus: "skipped",
        reason: "duplicate_idempotency_key_in_execution",
      }),
    ]);
    expect(result.summary).toMatchObject({
      candidates: 1,
      updated: 1,
      skipped: 1,
      errors: 0,
    });
  });

  it("returns results in deterministic accommodation order", async () => {
    const service = buildService(
      [booking("apt-b", BookingStatus.CONFIRMED), booking("apt-a", BookingStatus.CONFIRMED)],
      [],
      async () => ({ status: "updated" }),
    );

    const result = await service.sync(DATE);

    expect(result.results.map((item) => item.accommodationId)).toEqual(["apt-a", "apt-b"]);
  });

  it("never calls PineOS twice for the same accommodation in one sync", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const service = buildService(
      [
        booking("apt-1", BookingStatus.CONFIRMED, { id: "checkout-1", reference: "ref-1" }),
        booking("apt-1", BookingStatus.CONFIRMED, { id: "checkout-2", reference: "ref-2" }),
        booking("apt-2", BookingStatus.CONFIRMED, { id: "checkout-3" }),
        booking("apt-2", BookingStatus.CONFIRMED, { id: "checkout-3" }),
      ],
      [],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
    );

    await service.sync(DATE);

    const callCounts = calls.reduce<Record<string, number>>((counts, call) => {
      counts[call.accommodationId] = (counts[call.accommodationId] ?? 0) + 1;
      return counts;
    }, {});

    expect(callCounts).toEqual({ "apt-2": 1 });
  });

  it("does not send out when an operational block is the only checkout", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const service = buildService(
      [booking("apt-1", BookingStatus.CONFIRMED, {
        bookingType: "MAINTENANCE",
        comment: "service window",
      })],
      [],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
    );

    const result = await service.sync(DATE);

    expect(calls).toHaveLength(0);
    expect(result.summary).toMatchObject({
      operationalBlocksSkipped: 1,
      candidates: 0,
      skipped: 1,
    });
    expect(result.results[0]).toMatchObject({
      accommodationId: "apt-1",
      computedStatus: null,
      rpcStatus: "skipped",
      reason: "operational_block",
      operationalBlock: {
        id: "apt-1-CONFIRMED",
        reference: "apt-1-ref",
        arrival: DATE,
        departure: DATE,
        comment: "service window",
      },
    });
  });

  it("sends out when a real checkout is followed only by an operational block", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const service = buildService(
      [booking("apt-1", BookingStatus.CONFIRMED, { id: "checkout-real" })],
      [booking("apt-1", BookingStatus.CONFIRMED, {
        id: "block-in",
        bookingType: "MAINTENANCE",
        comment: "service window",
      })],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
    );

    const result = await service.sync(DATE);

    expect(calls).toHaveLength(1);
    expect(calls[0].authorizationStatus).toBe("out");
    expect(calls[0].payload).toMatchObject({
      booking_out_id: "checkout-real",
      booking_in_id: null,
      classification: "GUEST_CHECKOUT_ONLY",
      operational_block: {
        id: "block-in",
        reference: "apt-1-ref",
        arrival: DATE,
        departure: DATE,
        comment: "service window",
      },
    });
    expect(result.summary).toMatchObject({
      operationalBlocksSkipped: 1,
      candidates: 1,
    });
  });

  it("still sends tim when a real checkout is followed by a real reservation", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const service = buildService(
      [booking("apt-1", BookingStatus.CONFIRMED, { id: "checkout-real" })],
      [booking("apt-1", BookingStatus.CONFIRMED, {
        id: "checkin-real",
        guest: { name: "Guest Name" },
      })],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
    );

    await service.sync(DATE);

    expect(calls).toHaveLength(1);
    expect(calls[0].authorizationStatus).toBe("tim");
    expect(calls[0].payload).toMatchObject({
      booking_in_id: "checkin-real",
      classification: "GUEST_TURNOVER",
    });
  });

  it("skips sync when an unknown calendar record is relevant to the accommodation", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const service = buildService(
      [booking("apt-1", BookingStatus.CONFIRMED, { id: "checkout-real" })],
      [booking("apt-1", BookingStatus.CONFIRMED, {
        id: "unknown-in",
        amount: 0,
      })],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
    );

    const result = await service.sync(DATE);

    expect(calls).toHaveLength(0);
    expect(result.summary).toMatchObject({
      unknownRecordsSkipped: 1,
      skipped: 1,
      candidates: 0,
    });
    expect(result.results[0]).toMatchObject({
      accommodationId: "apt-1",
      computedStatus: null,
      rpcStatus: "skipped",
      reason: "unknown_calendar_record",
    });
  });

  it("logs only safe diagnostic structure for classification and sync events", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const sensitiveBlock = productionLikeOperationalBlock("apt-1", {
      id: "block-in",
      reference: "block-ref",
      email: "test@example.com",
      phone: "+55 21 99999-9999",
      document: "123.456.789-00",
    });
    const service = buildService(
      [
        booking("apt-1", BookingStatus.CONFIRMED, {
          id: "checkout-real",
          guest: { name: "Test Guest" },
          email: "test@example.com",
          phone: "+55 21 99999-9999",
          document: "123.456.789-00",
        }),
        booking("apt-2", BookingStatus.CONFIRMED, {
          id: "dup-checkout",
          reference: "dup-ref",
        }),
        booking("apt-2", BookingStatus.CONFIRMED, {
          id: "dup-checkout",
          reference: "dup-ref",
        }),
        booking("apt-3", BookingStatus.CONFIRMED, {
          id: "ambiguous-a",
          reference: "ambiguous-a",
        }),
        booking("apt-3", BookingStatus.CONFIRMED, {
          id: "ambiguous-b",
          reference: "ambiguous-b",
        }),
      ],
      [
        sensitiveBlock,
        booking("apt-4", BookingStatus.CONFIRMED, {
          id: "unknown-in",
          amount: 0,
          email: "test@example.com",
          phone: "+55 21 99999-9999",
          document: "123.456.789-00",
        }),
      ],
      async (input) => {
        if (input.accommodationId === "apt-1") {
          throw new Error("PineOS failure without secrets");
        }
        return { status: "updated" };
      },
    );

    await service.sync(DATE);

    const loggedObjects = logSpy.mock.calls
      .filter((call) => call[0] === "[AuthorizationSync]")
      .map((call) => call[1]);
    const logged = JSON.stringify(loggedObjects);

    expect(loggedObjects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: "operational_block",
        calendarRecordKind: "OPERATIONAL_BLOCK",
        hasComment: true,
        topLevelFieldNames: expect.arrayContaining(["client", "comment"]),
        classificationSignals: expect.objectContaining({
          hasComment: true,
          hasPlaceholderOccupancyPattern: true,
        }),
      }),
      expect.objectContaining({
        event: "unknown_calendar_record",
        calendarRecordKind: "UNKNOWN",
        hasComment: false,
      }),
      expect.objectContaining({
        event: "duplicate_suppressed",
        reason: "duplicate_stable_identity",
      }),
      expect.objectContaining({
        event: "accommodation_skipped",
        reason: "ambiguous_multiple_checkouts",
      }),
      expect.objectContaining({
        event: "pineos_sync_error",
        reason: "PineOS failure without secrets",
      }),
    ]));

    expect(logged).toContain('"hasComment":true');
    expect(logged).not.toContain("Test Guest");
    expect(logged).not.toContain("test@example.com");
    expect(logged).not.toContain("+55 21 99999-9999");
    expect(logged).not.toContain("Dedetização");
    expect(logged).not.toContain("123.456.789-00");
    expect(logged).not.toContain("guest@example.com");
    expect(logged).not.toContain("Sensitive Guest");
    expect(logged).not.toContain("sensitive operational comment");
  });

  it("keeps summary counters semantics for local skips and candidates", async () => {
    const service = buildService(
      [
        booking("apt-1", BookingStatus.CONFIRMED, { id: "checkout-real" }),
        booking("apt-2", BookingStatus.CONFIRMED, { id: "dup" }),
        booking("apt-2", BookingStatus.CONFIRMED, { id: "dup" }),
        booking("apt-3", BookingStatus.CONFIRMED, { bookingType: "MAINTENANCE" }),
        booking("apt-4", BookingStatus.CONFIRMED, { id: "amb-1", reference: "amb-1" }),
        booking("apt-4", BookingStatus.CONFIRMED, { id: "amb-2", reference: "amb-2" }),
        booking("apt-5", BookingStatus.CONFIRMED, {
          stayDates: { arrival: DATE, departure: "2026-06-23" },
        }),
      ],
      [
        booking("apt-1", BookingStatus.CONFIRMED, { id: "unknown-in", amount: 0 }),
        booking("apt-6", BookingStatus.CONFIRMED, {
          stayDates: { arrival: "2026-06-23", departure: "2026-06-24" },
        }),
      ],
      async () => ({ status: "updated" }),
    );

    const result = await service.sync(DATE);

    expect(result.summary).toMatchObject({
      rawCheckins: 2,
      rawCheckouts: 7,
      validCheckins: 2,
      validCheckouts: 7,
      dateMismatchCheckinsSkipped: 1,
      dateMismatchCheckoutsSkipped: 1,
      operationalBlocksSkipped: 1,
      unknownRecordsSkipped: 1,
      duplicateCheckoutsSuppressed: 1,
      ambiguousAccommodations: 1,
      candidates: 1,
      skipped: 3,
      errors: 0,
    });
  });

  it("keeps the same decision when checkins are provided in reverse order", async () => {
    const buildScenario = (checkins: AvantioBooking[]) => {
      const calls: AuthorizationSyncPayload[] = [];
      const service = buildService(
        [booking("apt-1", BookingStatus.CONFIRMED, { id: "checkout-real" })],
        checkins,
        async (input) => {
          calls.push(input);
          return { status: "updated" };
        },
      );
      return { calls, service };
    };
    const checkins = [
      booking("apt-2", BookingStatus.CONFIRMED, { id: "other-checkin" }),
      booking("apt-1", BookingStatus.CONFIRMED, { id: "checkin-real", guest: { name: "Guest Name" } }),
    ];

    const forward = buildScenario(checkins);
    const reverse = buildScenario([...checkins].reverse());

    await forward.service.sync(DATE);
    await reverse.service.sync(DATE);

    expect(forward.calls).toHaveLength(1);
    expect(reverse.calls).toHaveLength(1);
    expect(forward.calls[0]).toMatchObject({
      accommodationId: reverse.calls[0].accommodationId,
      authorizationStatus: reverse.calls[0].authorizationStatus,
      idempotencyKey: reverse.calls[0].idempotencyKey,
    });
    expect(forward.calls[0].payload).toMatchObject({
      booking_in_id: "checkin-real",
      classification: "GUEST_TURNOVER",
    });
    expect(reverse.calls[0].payload).toMatchObject({
      booking_in_id: "checkin-real",
      classification: "GUEST_TURNOVER",
    });
  });

  it("keeps the same decision when duplicate checkouts are provided in reverse order", async () => {
    const first = booking("apt-1", BookingStatus.CONFIRMED, { id: "checkout-b", reference: "same-ref" });
    const second = booking("apt-1", BookingStatus.CONFIRMED, { id: "checkout-a", reference: "same-ref" });
    const buildScenario = (checkouts: AvantioBooking[]) => {
      const calls: AuthorizationSyncPayload[] = [];
      const service = buildService(checkouts, [], async (input) => {
        calls.push(input);
        return { status: "updated" };
      });
      return { calls, service };
    };

    const forward = buildScenario([first, second]);
    const reverse = buildScenario([second, first]);

    await forward.service.sync(DATE);
    await reverse.service.sync(DATE);

    expect(forward.calls).toHaveLength(1);
    expect(reverse.calls).toHaveLength(1);
    expect(forward.calls[0].payload).toMatchObject({ booking_out_id: "checkout-a" });
    expect(reverse.calls[0].payload).toMatchObject({ booking_out_id: "checkout-a" });
  });

  it("keeps one decision when the same reservation is repeated many times", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const repeatedCheckout = booking("apt-1", BookingStatus.CONFIRMED, { id: "checkout-real" });
    const service = buildService(
      Array.from({ length: 5 }, () => ({ ...repeatedCheckout })),
      [],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
    );

    const result = await service.sync(DATE);

    expect(calls).toHaveLength(1);
    expect(calls[0].authorizationStatus).toBe("out");
    expect(result.summary).toMatchObject({
      candidates: 1,
      duplicateCheckoutsSuppressed: 4,
    });
  });

  it("does not transform out into tim when an operational block is added", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const service = buildService(
      [booking("apt-1", BookingStatus.CONFIRMED, { id: "checkout-real" })],
      [booking("apt-1", BookingStatus.CONFIRMED, {
        id: "block-in",
        bookingType: "MAINTENANCE",
        comment: "service window",
      })],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
    );

    await service.sync(DATE);

    expect(calls).toHaveLength(1);
    expect(calls[0].authorizationStatus).toBe("out");
    expect(calls[0].payload).toMatchObject({
      booking_in_id: null,
      classification: "GUEST_CHECKOUT_ONLY",
    });
  });

  it("sends out when a real checkout is followed by a production-like operational block", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const service = buildService(
      [booking("apt-1", BookingStatus.CONFIRMED, {
        id: "checkout-real",
        reference: "checkout-real",
        guest: { name: "Fictional Guest" },
      })],
      [productionLikeOperationalBlock("apt-1", {
        id: "production-block-in",
        reference: "production-block-in",
      })],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
    );

    const result = await service.sync(DATE);

    expect(calls).toHaveLength(1);
    expect(calls[0].authorizationStatus).toBe("out");
    expect(calls[0].authorizationStatus).not.toBe("tim");
    expect(calls[0].payload).toMatchObject({
      booking_out_id: "checkout-real",
      booking_in_id: null,
      classification: "GUEST_CHECKOUT_ONLY",
      operational_block: {
        id: "production-block-in",
        reference: "production-block-in",
        arrival: DATE,
        departure: DATE,
        comment: "Dedetização",
      },
    });
    expect(result.summary).toMatchObject({
      operationalBlocksSkipped: 1,
      candidates: 1,
    });
  });

  it("does not send out when a production-like operational block is the only checkout", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const service = buildService(
      [productionLikeOperationalBlock("apt-1", {
        id: "production-block-out",
        reference: "production-block-out",
      })],
      [],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
    );

    const result = await service.sync(DATE);

    expect(calls).toHaveLength(0);
    expect(result.summary).toMatchObject({
      operationalBlocksSkipped: 1,
      candidates: 0,
      skipped: 1,
    });
    expect(result.results[0]).toMatchObject({
      accommodationId: "apt-1",
      computedStatus: null,
      rpcStatus: "skipped",
      reason: "operational_block",
    });
  });

  it("does not send a PineOS call when a production-like operational block is the only checkin", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const service = buildService(
      [],
      [productionLikeOperationalBlock("apt-1", {
        id: "production-block-in",
        reference: "production-block-in",
      })],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
    );

    const result = await service.sync(DATE);

    expect(calls).toHaveLength(0);
    expect(result.summary).toMatchObject({
      operationalBlocksSkipped: 1,
      candidates: 0,
      skipped: 1,
    });
    expect(result.results).toEqual([
      expect.objectContaining({
        accommodationId: "apt-1",
        computedStatus: null,
        rpcStatus: "skipped",
        reason: "operational_block",
      }),
    ]);
  });

  it("keeps duplicate production-like operational blocks from affecting a real checkout decision", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const duplicateBlock = productionLikeOperationalBlock("apt-1", {
      id: "production-block-in",
      reference: "production-block-in",
    });
    const service = buildService(
      [booking("apt-1", BookingStatus.CONFIRMED, {
        id: "checkout-real",
        guest: { name: "Fictional Guest" },
      })],
      [duplicateBlock, { ...duplicateBlock }],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
    );

    const result = await service.sync(DATE);

    expect(calls).toHaveLength(1);
    expect(calls[0].authorizationStatus).toBe("out");
    expect(calls[0].payload).toMatchObject({
      booking_in_id: null,
      classification: "GUEST_CHECKOUT_ONLY",
      operational_block: {
        id: "production-block-in",
        reference: "production-block-in",
      },
    });
    expect(result.summary).toMatchObject({
      duplicateCheckinsSuppressed: 1,
      operationalBlocksSkipped: 1,
      candidates: 1,
    });
  });

  it("keeps OWNER checkins in the existing owner cleaning rules", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const service = buildService(
      [booking("apt-1", BookingStatus.CONFIRMED, {
        id: "guest-checkout",
        guest: { name: "Fictional Guest" },
      })],
      [booking("apt-1", BookingStatus.OWNER, {
        id: "owner-checkin",
      })],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
    );

    await service.sync(DATE);

    expect(calls).toHaveLength(1);
    expect(calls[0].authorizationStatus).toBe("tim");
    expect(calls[0].payload).toMatchObject({
      booking_out_id: "guest-checkout",
      booking_in_id: "owner-checkin",
      classification: "GUEST_TO_OWNER",
    });
  });

  it("keeps the same decision when mixed real and operational records are provided in different order", async () => {
    const checkout = booking("apt-1", BookingStatus.CONFIRMED, {
      id: "checkout-real",
      guest: { name: "Fictional Guest" },
    });
    const realCheckin = booking("apt-1", BookingStatus.CONFIRMED, {
      id: "checkin-real",
      reference: "checkin-real",
      guest: { name: "Next Fictional Guest" },
    });
    const operationalBlock = productionLikeOperationalBlock("apt-1", {
      id: "production-block-in",
      reference: "production-block-in",
    });
    const buildScenario = (checkins: AvantioBooking[]) => {
      const calls: AuthorizationSyncPayload[] = [];
      const service = buildService([checkout], checkins, async (input) => {
        calls.push(input);
        return { status: "updated" };
      });
      return { calls, service };
    };

    const forward = buildScenario([operationalBlock, realCheckin]);
    const reverse = buildScenario([realCheckin, operationalBlock]);

    await forward.service.sync(DATE);
    await reverse.service.sync(DATE);

    expect(forward.calls).toHaveLength(1);
    expect(reverse.calls).toHaveLength(1);
    expect(forward.calls[0]).toMatchObject({
      accommodationId: "apt-1",
      authorizationStatus: "tim",
    });
    expect(reverse.calls[0]).toMatchObject({
      accommodationId: "apt-1",
      authorizationStatus: "tim",
    });
    expect(forward.calls[0].payload).toMatchObject({
      booking_in_id: "checkin-real",
      classification: "GUEST_TURNOVER",
      operational_block: {
        id: "production-block-in",
        reference: "production-block-in",
      },
    });
    expect(reverse.calls[0].payload).toMatchObject({
      booking_in_id: "checkin-real",
      classification: "GUEST_TURNOVER",
      operational_block: {
        id: "production-block-in",
        reference: "production-block-in",
      },
    });
  });

  it("skips instead of choosing arbitrarily when a distinct real reservation is added", async () => {
    const calls: AuthorizationSyncPayload[] = [];
    const service = buildService(
      [booking("apt-1", BookingStatus.CONFIRMED, { id: "checkout-real" })],
      [
        booking("apt-1", BookingStatus.CONFIRMED, { id: "checkin-a", reference: "checkin-a", guest: { name: "Guest A" } }),
        booking("apt-1", BookingStatus.CONFIRMED, { id: "checkin-b", reference: "checkin-b", guest: { name: "Guest B" } }),
      ],
      async (input) => {
        calls.push(input);
        return { status: "updated" };
      },
    );

    const result = await service.sync(DATE);

    expect(calls).toHaveLength(0);
    expect(result.summary).toMatchObject({
      candidates: 0,
      ambiguousAccommodations: 1,
      skipped: 1,
      errors: 0,
    });
    expect(result.results[0]).toMatchObject({
      rpcStatus: "skipped",
      reason: "ambiguous_multiple_checkins",
      computedStatus: null,
    });
  });
});

describe("PineOSKanbanAuthorizationClient", () => {
  it("requires PINEOS_KANBAN_AUTH_SYNC_URL", () => {
    expect(() => new PineOSKanbanAuthorizationClient({
      PINEOS_KANBAN_AUTH_SYNC_SECRET: "secret",
    } as any)).toThrow("PINEOS_KANBAN_AUTH_SYNC_URL is not configured");
  });

  it("requires PINEOS_KANBAN_AUTH_SYNC_SECRET", () => {
    expect(() => new PineOSKanbanAuthorizationClient({
      PINEOS_KANBAN_AUTH_SYNC_URL: "https://pineos.example/functions/v1/kanban-authorization-sync",
    } as any)).toThrow("PINEOS_KANBAN_AUTH_SYNC_SECRET is not configured");
  });

  it("sends backend requests with the shared secret and returns updated", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "updated", card_id: "card-1", new_status: "out" }), { status: 200 }),
    );
    const client = new PineOSKanbanAuthorizationClient({
      PINEOS_KANBAN_AUTH_SYNC_URL: "https://pineos.example/functions/v1/kanban-authorization-sync",
      PINEOS_KANBAN_AUTH_SYNC_SECRET: "shared-secret",
    } as any);

    const result = await client.syncAuthorization({
      accommodationId: "apt-1",
      propertyCode: "APT1",
      targetDate: DATE,
      authorizationStatus: "out",
      idempotencyKey: "avantio-status-sync:2026-06-22:apt-1",
      payload: { source: "test" },
    });

    expect(result).toEqual({ status: "updated", card_id: "card-1", new_status: "out" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://pineos.example/functions/v1/kanban-authorization-sync",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "x-kanban-auth-sync-secret": "shared-secret",
        },
        body: JSON.stringify({
          accommodationId: "apt-1",
          propertyCode: "APT1",
          targetDate: DATE,
          authorizationStatus: "out",
          authorizationSource: "avantio-status-sync",
          idempotencyKey: "avantio-status-sync:2026-06-22:apt-1",
          payload: { source: "test" },
        }),
      }),
    );
  });

  it("returns unchanged from the backend", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "unchanged", previous_status: "tim", new_status: "tim" }), { status: 200 }),
    );
    const client = new PineOSKanbanAuthorizationClient({
      PINEOS_KANBAN_AUTH_SYNC_URL: "https://pineos.example/functions/v1/kanban-authorization-sync",
      PINEOS_KANBAN_AUTH_SYNC_SECRET: "shared-secret",
    } as any);

    await expect(client.syncAuthorization({
      accommodationId: "apt-1",
      targetDate: DATE,
      authorizationStatus: "tim",
      idempotencyKey: "avantio-status-sync:2026-06-22:apt-1",
      payload: {},
    })).resolves.toEqual({ status: "unchanged", previous_status: "tim", new_status: "tim" });
  });

  it("returns skipped manual_late_not_overwritten from the backend", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "skipped", reason: "manual_late_not_overwritten" }), { status: 200 }),
    );
    const client = new PineOSKanbanAuthorizationClient({
      PINEOS_KANBAN_AUTH_SYNC_URL: "https://pineos.example/functions/v1/kanban-authorization-sync",
      PINEOS_KANBAN_AUTH_SYNC_SECRET: "shared-secret",
    } as any);

    await expect(client.syncAuthorization({
      accommodationId: "apt-1",
      targetDate: DATE,
      authorizationStatus: "out",
      idempotencyKey: "avantio-status-sync:2026-06-22:apt-1",
      payload: {},
    })).resolves.toEqual({ status: "skipped", reason: "manual_late_not_overwritten" });
  });

  it("throws on backend HTTP failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("bad secret", { status: 401 }),
    );
    const client = new PineOSKanbanAuthorizationClient({
      PINEOS_KANBAN_AUTH_SYNC_URL: "https://pineos.example/functions/v1/kanban-authorization-sync",
      PINEOS_KANBAN_AUTH_SYNC_SECRET: "shared-secret",
    } as any);

    await expect(client.syncAuthorization({
      accommodationId: "apt-1",
      targetDate: DATE,
      authorizationStatus: "out",
      idempotencyKey: "avantio-status-sync:2026-06-22:apt-1",
      payload: {},
    })).rejects.toThrow("PineOS authorization sync failed: 401 bad secret");
  });

  it("redacts the shared secret from backend HTTP failure text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("shared-secret leaked", { status: 500 }),
    );
    const client = new PineOSKanbanAuthorizationClient({
      PINEOS_KANBAN_AUTH_SYNC_URL: "https://pineos.example/functions/v1/kanban-authorization-sync",
      PINEOS_KANBAN_AUTH_SYNC_SECRET: "shared-secret",
    } as any);

    await expect(client.syncAuthorization({
      accommodationId: "apt-1",
      targetDate: DATE,
      authorizationStatus: "out",
      idempotencyKey: "avantio-status-sync:2026-06-22:apt-1",
      payload: {},
    })).rejects.toThrow("PineOS authorization sync failed: 500 [redacted] leaked");
  });
});

describe("todayInSaoPaulo", () => {
  it("uses America/Sao_Paulo for the default date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T02:30:00.000Z"));

    expect(todayInSaoPaulo()).toBe("2026-06-21");
  });
});
