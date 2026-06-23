import { describe, expect, it, vi, afterEach } from "vitest";
import { SyncAuthorizationStatusService } from "../../src/services/v1/kanban/syncAuthorizationStatusService";
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

function buildService(
  checkouts: AvantioBooking[],
  checkins: AvantioBooking[],
  syncAuthorization: (input: AuthorizationSyncPayload) => Promise<AuthorizationSyncResult>,
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
      payload: {},
    })).rejects.toThrow("PineOS authorization sync failed: 401 bad secret");
  });
});

describe("todayInSaoPaulo", () => {
  it("uses America/Sao_Paulo for the default date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T02:30:00.000Z"));

    expect(todayInSaoPaulo()).toBe("2026-06-21");
  });
});
