import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvantioApiGateway } from "../../src/apiGateways/avantio/getAppointments";
import {
  CangeAuthorizationDecisions,
  todayInSaoPaulo,
} from "../../src/controllers/v1/cange/authorizationDecisions/authorizationDecisions";
import { RemovedKanbanAuthorizationSync } from "../../src/controllers/v1/kanban/syncAuthorizationStatus/syncAuthorizationStatus";
import { CangeAuthorizationDecisionService } from "../../src/services/v1/cange/cangeAuthorizationDecisionService";
import { AvantioBooking, BookingStatus } from "../../src/types/avantioTypes";

const DATE = "2026-06-22";
const PRODUCTION_DATE = "2026-07-11";

type JsonResponse = {
  body: unknown;
  status: number;
};

function buildContext(input: {
  method: string;
  url: string;
  body?: unknown;
  contentType?: string;
}) {
  return {
    env: {
      AVANTIO_API_KEY: "",
      AVANTIO_BASE_URL: "",
      API_KEY: "",
      DB: {} as D1Database,
    },
    req: {
      method: input.method,
      url: input.url,
      header: (name: string) => {
        if (name.toLowerCase() === "content-type") return input.contentType ?? null;
        return null;
      },
      json: async () => input.body,
    },
    json: (body: unknown, status = 200): JsonResponse => ({ body, status }),
  };
}

function sparseBooking(accommodationId: string, overrides: Record<string, unknown> = {}): AvantioBooking {
  return {
    id: `${accommodationId}-booking`,
    creationDate: PRODUCTION_DATE,
    createdAt: PRODUCTION_DATE,
    updatedAt: PRODUCTION_DATE,
    stayDates: {
      arrival: PRODUCTION_DATE,
      departure: PRODUCTION_DATE,
    },
    status: BookingStatus.CONFIRMED,
    companyId: "company",
    accommodationId,
    ...overrides,
  } as AvantioBooking;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("CangeAuthorizationDecisions route", () => {
  it("serves GET /v1/cange/authorization-decisions?date=YYYY-MM-DD", async () => {
    const serviceSpy = vi.spyOn(CangeAuthorizationDecisionService.prototype, "getDecisions").mockResolvedValue({
      success: true,
      mode: "decision_only",
      date: DATE,
      summary: {
        rawCheckins: 0,
        rawCheckouts: 0,
        validCheckins: 0,
        validCheckouts: 0,
        dateMismatchCheckinsSkipped: 0,
        dateMismatchCheckoutsSkipped: 0,
        operationalBlocksSkipped: 0,
        unknownRecordsSkipped: 0,
        duplicateCheckinsSuppressed: 0,
        duplicateCheckoutsSuppressed: 0,
        ambiguousAccommodations: 0,
        candidates: 0,
        decisions: 0,
        skipped: 0,
        errors: 0,
      },
      decisions: [],
      skipped: [],
    });

    const response = await new CangeAuthorizationDecisions().handle(buildContext({
      method: "GET",
      url: `http://local.test/v1/cange/authorization-decisions?date=${DATE}`,
    }) as never);

    expect(serviceSpy).toHaveBeenCalledWith(DATE);
    expect(response).toEqual({
      status: 200,
      body: expect.objectContaining({
        success: true,
        mode: "decision_only",
        date: DATE,
      }),
    });
  });

  it("serves POST /v1/cange/authorization-decisions with a JSON date body", async () => {
    const serviceSpy = vi.spyOn(CangeAuthorizationDecisionService.prototype, "getDecisions").mockResolvedValue({
      success: true,
      mode: "decision_only",
      date: DATE,
      summary: {
        rawCheckins: 0,
        rawCheckouts: 0,
        validCheckins: 0,
        validCheckouts: 0,
        dateMismatchCheckinsSkipped: 0,
        dateMismatchCheckoutsSkipped: 0,
        operationalBlocksSkipped: 0,
        unknownRecordsSkipped: 0,
        duplicateCheckinsSuppressed: 0,
        duplicateCheckoutsSuppressed: 0,
        ambiguousAccommodations: 0,
        candidates: 0,
        decisions: 0,
        skipped: 0,
        errors: 0,
      },
      decisions: [],
      skipped: [],
    });

    const response = await new CangeAuthorizationDecisions().handle(buildContext({
      method: "POST",
      url: "http://local.test/v1/cange/authorization-decisions",
      body: { date: DATE },
      contentType: "application/json",
    }) as never);

    expect(serviceSpy).toHaveBeenCalledWith(DATE);
    expect(response.status).toBe(200);
  });

  it("returns 400 for invalid date input", async () => {
    const serviceSpy = vi.spyOn(CangeAuthorizationDecisionService.prototype, "getDecisions");

    const response = await new CangeAuthorizationDecisions().handle(buildContext({
      method: "GET",
      url: "http://local.test/v1/cange/authorization-decisions?date=2026-13-99",
    }) as never);

    expect(serviceSpy).not.toHaveBeenCalled();
    expect(response).toEqual({
      status: 400,
      body: {
        success: false,
        message: "date must be in YYYY-MM-DD format",
      },
    });
  });

  it("uses today's Sao_Paulo date when date is omitted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T02:30:00.000Z"));
    const serviceSpy = vi.spyOn(CangeAuthorizationDecisionService.prototype, "getDecisions").mockResolvedValue({
      success: true,
      mode: "decision_only",
      date: "2026-06-21",
      summary: {
        rawCheckins: 0,
        rawCheckouts: 0,
        validCheckins: 0,
        validCheckouts: 0,
        dateMismatchCheckinsSkipped: 0,
        dateMismatchCheckoutsSkipped: 0,
        operationalBlocksSkipped: 0,
        unknownRecordsSkipped: 0,
        duplicateCheckinsSuppressed: 0,
        duplicateCheckoutsSuppressed: 0,
        ambiguousAccommodations: 0,
        candidates: 0,
        decisions: 0,
        skipped: 0,
        errors: 0,
      },
      decisions: [],
      skipped: [],
    });

    await new CangeAuthorizationDecisions().handle(buildContext({
      method: "GET",
      url: "http://local.test/v1/cange/authorization-decisions",
    }) as never);

    expect(serviceSpy).toHaveBeenCalledWith("2026-06-21");
    vi.useRealTimers();
  });

  it("calculates Sao_Paulo today deterministically", () => {
    expect(todayInSaoPaulo(new Date("2026-06-22T02:30:00.000Z"))).toBe("2026-06-21");
  });

  it("returns 200 for sparse Avantio bookings without optional references or structural metadata", async () => {
    vi.spyOn(AvantioApiGateway.prototype, "getCheckouts").mockResolvedValue([
      sparseBooking("apt-1", {
        guest: { id: "guest-out" },
        id1: undefined,
        reference: undefined,
        externalData: undefined,
        bookingType: undefined,
        reservationType: undefined,
        type: undefined,
        category: undefined,
        kind: undefined,
        source: undefined,
        channel: undefined,
      }),
    ]);
    vi.spyOn(AvantioApiGateway.prototype, "getCheckins").mockResolvedValue([
      sparseBooking("apt-2", {
        value: "R$ 0,00",
        client: "",
        adults: 1,
        children: 0,
        babies: 0,
        comment: "Dedetização",
        id1: undefined,
        reference: undefined,
        externalData: undefined,
      }),
    ]);

    const response = await new CangeAuthorizationDecisions().handle(buildContext({
      method: "GET",
      url: `http://local.test/v1/cange/authorization-decisions?date=${PRODUCTION_DATE}`,
    }) as never);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      mode: "decision_only",
      date: PRODUCTION_DATE,
      decisions: [
        expect.objectContaining({
          accommodationId: "apt-1",
          internalStatus: "out",
          cangeStatus: "OUT",
        }),
      ],
      skipped: [
        expect.objectContaining({
          accommodationId: "apt-2",
          reason: "operational_block",
        }),
      ],
    });
  });
});

describe("RemovedKanbanAuthorizationSync route", () => {
  it("returns 410 for the old PineOS authorization sync route", async () => {
    const response = await new RemovedKanbanAuthorizationSync().handle(buildContext({
      method: "POST",
      url: "http://local.test/v1/kanban/authorization-sync",
    }) as never);

    expect(response).toEqual({
      status: 410,
      body: {
        success: false,
        reason: "pineos_authorization_integration_removed",
        replacement: "/v1/cange/authorization-decisions",
      },
    });
  });
});
