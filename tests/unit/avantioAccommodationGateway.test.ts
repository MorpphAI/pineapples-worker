import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvantioApiGateway } from "../../src/apiGateways/avantio/getAppointments";
import { AvantioProviderError } from "../../src/integrations/avantio/accommodations";
import { createSuccess, createSuccessMissingId, knownGoodCreatePayload, multipleExactMatches, providerTemporaryError, providerValidationError, rawWithExternalReference, rawWithoutReference } from "../fixtures/avantioAccommodationCreate";

const env = { AVANTIO_API_KEY: "provider-secret", AVANTIO_BASE_URL: "https://provider.test", AVANTIO_ACCOMMODATION_CREATE_ENABLED: "true", API_KEY: "incoming-secret", DB: {} as D1Database };
function response(body: unknown, status = 200, headers: Record<string, string> = {}) { return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }); }

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("AvantioApiGateway accommodation methods", () => {
  it("retains raw externalReference fields and performs exact case-sensitive lookup", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => response({ data: [rawWithExternalReference, rawWithoutReference] })));
    const gateway = new AvantioApiGateway(env);
    expect((await gateway.getAccommodations())[0].externalReference).toBe("NSC314");
    expect(await gateway.findAccommodationsByExternalReference("NSC314")).toEqual([{ external_id: "accommodation-123", external_reference: "NSC314", label: "NSC314", remote_status: "ENABLED" }]);
    expect(await gateway.findAccommodationsByExternalReference("nsc314")).toEqual([]);
  });

  it("returns multiple exact matches", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ data: multipleExactMatches })));
    expect(await new AvantioApiGateway(env).findAccommodationsByExternalReference("NSC314")).toHaveLength(2);
  });

  it("preserves existing _links.next pagination for exact lookup", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ data: [rawWithoutReference], _links: { next: "https://provider.test/accommodations?page=2" } }))
      .mockResolvedValueOnce(response({ data: [rawWithExternalReference] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await new AvantioApiGateway(env).findAccommodationsByExternalReference("NSC314")).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("POSTs the validated payload once and parses response.data.id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(createSuccess, 201, { "x-request-id": "req-1" })); vi.stubGlobal("fetch", fetchMock);
    const result = await new AvantioApiGateway(env).createAccommodation(knownGoodCreatePayload);
    expect(result).toEqual({ externalId: "accommodation-123", remoteStatus: "ENABLED", providerRequestId: "req-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://provider.test/accommodations");
    expect(options).toMatchObject({ method: "POST", headers: { "X-Avantio-Auth": "provider-secret", accept: "application/json", "content-type": "application/json" } });
    expect(JSON.parse(options.body)).toEqual(knownGoodCreatePayload);
    expect(options.body).not.toContain("incoming-secret");
  });

  it("rejects a 2xx response without data.id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(createSuccessMissingId, 200)));
    await expect(new AvantioApiGateway(env).createAccommodation(knownGoodCreatePayload)).rejects.toMatchObject({ kind: "invalid_provider_response", code: "missing_external_id", status: 200 });
  });

  it.each([[400, providerValidationError], [401, {}], [403, {}], [422, providerValidationError]] as const)("classifies HTTP %s as provider_rejected", async (status, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body, status)));
    await expect(new AvantioApiGateway(env).createAccommodation(knownGoodCreatePayload)).rejects.toMatchObject({ kind: "provider_rejected", status });
  });

  it.each([[429, providerTemporaryError], [500, providerTemporaryError], [503, providerTemporaryError]] as const)("classifies received HTTP %s as temporarily_unavailable", async (status, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body, status)));
    await expect(new AvantioApiGateway(env).createAccommodation(knownGoodCreatePayload)).rejects.toMatchObject({ kind: "temporarily_unavailable", status });
  });

  it("classifies malformed provider JSON as a definite invalid response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("{not-json", 200)));
    await expect(new AvantioApiGateway(env).createAccommodation(knownGoodCreatePayload)).rejects.toMatchObject({ kind: "invalid_provider_response", code: "malformed_provider_json" });
  });

  it("classifies failure after fetch begins as uncertain and never retries", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("connection closed")); vi.stubGlobal("fetch", fetchMock);
    await expect(new AvantioApiGateway(env).createAccommodation(knownGoodCreatePayload)).rejects.toMatchObject({ kind: "uncertain", stage: "fetch_invoked" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not log API keys or full create payloads", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(providerValidationError, 400)));
    await expect(new AvantioApiGateway(env).createAccommodation(knownGoodCreatePayload)).rejects.toBeInstanceOf(AvantioProviderError);
    const logged = JSON.stringify([...errorSpy.mock.calls, ...logSpy.mock.calls]);
    expect(logged).not.toContain("provider-secret"); expect(logged).not.toContain("incoming-secret"); expect(logged).not.toContain("Avenida Exemplo");
  });
});
