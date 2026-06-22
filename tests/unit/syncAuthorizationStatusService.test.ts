import { describe, expect, it, vi, afterEach } from "vitest";
import { SyncAuthorizationStatusService } from "../../src/services/v1/kanban/syncAuthorizationStatusService";
import { AuthorizationSyncPayload, AuthorizationSyncRpcResult } from "../../src/repositories/kanban/supabaseKanbanRepository";
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

function buildService(
  checkouts: AvantioBooking[],
  checkins: AvantioBooking[],
  syncAuthorization: (input: AuthorizationSyncPayload) => Promise<AuthorizationSyncRpcResult>,
) {
  return new SyncAuthorizationStatusService(
    {} as any,
    {
      getCheckins: async () => checkins,
      getCheckouts: async () => checkouts,
    },
    { syncAuthorization },
  );
}

afterEach(() => {
  vi.useRealTimers();
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
    });
    expect(calls[0].payload).toMatchObject({
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

  it("counts skipped manual_late as skipped and manualSkipped", async () => {
    const service = buildService(
      [booking("apt-1", BookingStatus.CONFIRMED)],
      [],
      async () => ({ status: "skipped", reason: "manual_late" }),
    );

    const result = await service.sync(DATE);

    expect(result.summary.skipped).toBe(1);
    expect(result.summary.manualSkipped).toBe(1);
    expect(result.summary.errors).toBe(0);
  });

  it("continues when one Supabase RPC call fails", async () => {
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
});

describe("todayInSaoPaulo", () => {
  it("uses America/Sao_Paulo for the default date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T02:30:00.000Z"));

    expect(todayInSaoPaulo()).toBe("2026-06-21");
  });
});
