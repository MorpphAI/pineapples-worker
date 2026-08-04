import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvantioApiGateway } from "../../src/apiGateways/avantio/getAppointments";
import { AvantioProviderError } from "../../src/integrations/avantio/accommodations";
import { createSuccess, createSuccessMissingId, knownGoodCreatePayload, multipleExactMatches, providerTemporaryError, providerValidationError, rawWithExternalReference, rawWithoutReference } from "../fixtures/avantioAccommodationCreate";

const env = { AVANTIO_API_KEY: "provider-secret", AVANTIO_BASE_URL: "https://provider.test", AVANTIO_ACCOMMODATION_CREATE_ENABLED: "true", API_KEY: "incoming-secret", DB: {} as D1Database };
function response(body: unknown, status = 200, headers: Record<string, string> = {}) { return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }); }

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("AvantioApiGateway accommodation methods", () => {
  it("uses a list-level externalReference and compares it case-sensitively", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => response({ data: [rawWithExternalReference] }));
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new AvantioApiGateway(env);
    expect(await gateway.findAccommodationsByExternalReference("NSC314")).toEqual([{ external_id: "accommodation-123", external_reference: "NSC314", label: "NSC314", remote_status: "ENABLED" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    expect(await gateway.findAccommodationsByExternalReference("nsc314")).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetches strict detail when the list omits externalReference", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ data: [rawWithoutReference] }))
      .mockResolvedValueOnce(response({ data: { ...rawWithoutReference, externalReference: "NSC314" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await new AvantioApiGateway(env).findAccommodationsByExternalReference("NSC314")).toEqual([
      { external_id: "accommodation-456", external_reference: "NSC314", label: "Other", remote_status: "ENABLED" },
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://provider.test/accommodations/accommodation-456", expect.objectContaining({ method: "GET" }));
  });

  it("returns complete zero matches only after detail confirms no externalReference", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ data: [rawWithoutReference] }))
      .mockResolvedValueOnce(response({ data: rawWithoutReference }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await new AvantioApiGateway(env).findAccommodationsByExternalReference("NSC314")).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed when detail lookup fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ data: [rawWithoutReference] }))
      .mockResolvedValueOnce(response({}, 503));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new AvantioApiGateway(env).findAccommodationsByExternalReference("NSC314")).rejects.toMatchObject({ kind: "temporarily_unavailable", status: 503 });
  });

  it.each([
    ["galleryId-only", { galleryId: "gallery-only", name: "Gallery", status: "ENABLED" }],
    ["missing-ID", { name: "No ID", status: "ENABLED" }],
  ])("treats a %s list record as incomplete", async (_label, record) => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: [record] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new AvantioApiGateway(env).findAccommodationsByExternalReference("NSC314")).rejects.toMatchObject({ kind: "temporarily_unavailable", code: "missing_authoritative_accommodation_id" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [404, "temporarily_unavailable"], [400, "provider_rejected"], [401, "provider_rejected"], [403, "provider_rejected"],
    [429, "temporarily_unavailable"], [500, "temporarily_unavailable"],
  ] as const)("normalizes strict detail HTTP %s as %s", async (status, kind) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({}, status)));
    await expect(new AvantioApiGateway(env).getAccommodationStrict("accommodation-1")).rejects.toMatchObject({ kind, status });
  });

  it.each([
    ["malformed JSON", response("{bad", 200), "malformed_provider_json"],
    ["missing data", response({}, 200), "missing_accommodation_detail_data"],
  ])("fails strict detail on %s", async (_label, providerResponse, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerResponse));
    await expect(new AvantioApiGateway(env).getAccommodationStrict("accommodation-1")).rejects.toMatchObject({ kind: "temporarily_unavailable", code });
  });

  it("normalizes strict detail network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(new AvantioApiGateway(env).getAccommodationStrict("accommodation-1")).rejects.toMatchObject({ kind: "temporarily_unavailable", code: "provider_detail_network_failure" });
  });

  it("returns multiple exact matches", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ data: multipleExactMatches })));
    expect(await new AvantioApiGateway(env).findAccommodationsByExternalReference("NSC314")).toHaveLength(2);
  });

  it("preserves existing _links.next pagination for exact lookup", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ data: [rawWithoutReference], _links: { next: "https://provider.test/accommodations?page=2" } }))
      .mockResolvedValueOnce(response({ data: [rawWithExternalReference] }))
      .mockResolvedValueOnce(response({ data: rawWithoutReference }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await new AvantioApiGateway(env).findAccommodationsByExternalReference("NSC314")).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe("https://provider.test/accommodations?page=2");
    expect(fetchMock.mock.calls[2][0]).toBe("https://provider.test/accommodations/accommodation-456");
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

  it.each([
    [201, createSuccessMissingId, "missing ID"],
    [200, { data: { id: null } }, "null ID"],
    [200, { data: { id: "   " } }, "blank ID"],
    [200, { data: { id: {} } }, "unnormalizable ID"],
    [200, {}, "invalid envelope"],
  ])("classifies HTTP %s with %s as uncertain", async (status, body) => {
    const fetchMock = vi.fn().mockResolvedValue(response(body, status, { "x-request-id": "req-uncertain" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new AvantioApiGateway(env).createAccommodation(knownGoodCreatePayload)).rejects.toMatchObject({ kind: "uncertain", code: "missing_external_id", status, providerRequestId: "req-uncertain" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([[400, providerValidationError], [401, {}], [403, {}], [422, providerValidationError]] as const)("classifies HTTP %s as provider_rejected", async (status, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body, status)));
    await expect(new AvantioApiGateway(env).createAccommodation(knownGoodCreatePayload)).rejects.toMatchObject({ kind: "provider_rejected", status });
  });

  it.each([[429, providerTemporaryError], [500, providerTemporaryError], [503, providerTemporaryError]] as const)("classifies received HTTP %s as temporarily_unavailable", async (status, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body, status)));
    await expect(new AvantioApiGateway(env).createAccommodation(knownGoodCreatePayload)).rejects.toMatchObject({ kind: "temporarily_unavailable", status });
  });

  it("classifies malformed 2xx provider JSON as uncertain without retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response("{not-json", 200, { "x-request-id": "req-json" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new AvantioApiGateway(env).createAccommodation(knownGoodCreatePayload)).rejects.toMatchObject({ kind: "uncertain", code: "malformed_provider_json", status: 200, providerRequestId: "req-json" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies an unreadable 2xx body as uncertain without retry", async () => {
    const unreadable = { ok: true, status: 200, headers: new Headers({ "x-request-id": "req-body" }), text: vi.fn().mockRejectedValue(new Error("stream failed")) } as unknown as Response;
    const fetchMock = vi.fn().mockResolvedValue(unreadable);
    vi.stubGlobal("fetch", fetchMock);
    await expect(new AvantioApiGateway(env).createAccommodation(knownGoodCreatePayload)).rejects.toMatchObject({ kind: "uncertain", code: "provider_body_unreadable", status: 200, providerRequestId: "req-body" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
