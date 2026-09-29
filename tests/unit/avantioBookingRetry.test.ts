import { afterEach, describe, expect, it, vi } from "vitest";
import { AvantioApiGateway } from "../../src/apiGateways/avantio/getAppointments";
import { AvantioProviderError } from "../../src/integrations/avantio/accommodations/providerErrors";
import { BookingStatus } from "../../src/types/avantioTypes";
import { Env } from "../../src/types/configTypes";

const DATE = "2026-09-29";

function gateway(): AvantioApiGateway {
  return new AvantioApiGateway({
    AVANTIO_API_KEY: "test-key",
    AVANTIO_BASE_URL: "https://avantio.test",
    API_KEY: "worker-key",
    DB: {} as D1Database,
  } satisfies Env);
}

function okBookingResponse() {
  return new Response(JSON.stringify({
    data: [{
      id: "booking-1",
      creationDate: DATE,
      createdAt: DATE,
      updatedAt: DATE,
      stayDates: { arrival: DATE, departure: DATE },
      status: BookingStatus.CONFIRMED,
      companyId: "company",
      accommodationId: "apt-1",
    }],
    _links: {},
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Avantio booking list retries", () => {
  it("retries a transient 503 and succeeds", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("temporarily unavailable", {
        status: 503,
        headers: { "x-request-id": "req-503" },
      }))
      .mockResolvedValueOnce(okBookingResponse());

    const pending = gateway().getCheckouts(DATE);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    expect(result[0].accommodationId).toBe("apt-1");
  });

  it("retries a network failure and succeeds", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(okBookingResponse());

    const pending = gateway().getCheckins(DATE);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
  });

  it("does not retry a permanent 401", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("unauthorized", { status: 401 }),
    );

    await expect(gateway().getCheckouts(DATE)).rejects.toMatchObject({
      name: "AvantioProviderError",
      code: "provider_http_401",
      kind: "provider_rejected",
      status: 401,
    } satisfies Partial<AvantioProviderError>);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns a typed temporary error after all transient attempts fail", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("unavailable", { status: 503 }),
    );

    const pending = gateway().getCheckouts(DATE);
    const rejection = expect(pending).rejects.toMatchObject({
      name: "AvantioProviderError",
      code: "provider_http_503",
      kind: "temporarily_unavailable",
      status: 503,
    } satisfies Partial<AvantioProviderError>);

    await vi.runAllTimersAsync();
    await rejection;
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });
});
