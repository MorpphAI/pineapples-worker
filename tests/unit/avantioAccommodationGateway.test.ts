import { env as testEnv } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvantioApiGateway } from "../../src/apiGateways/avantio/getAppointments";
import { AvantioProviderError } from "../../src/integrations/avantio/accommodations";
import { createSuccess, createSuccessMissingId, knownGoodCreatePayload, providerTemporaryError, providerValidationError, rawWithExternalReference } from "../fixtures/avantioAccommodationCreate";

const env = { AVANTIO_API_KEY: "provider-secret", AVANTIO_BASE_URL: "https://provider.test", AVANTIO_ACCOMMODATION_CREATE_ENABLED: "true", AVANTIO_ACCOMMODATION_INDEX_MAX_AGE_SECONDS: "900", API_KEY: "incoming-secret", DB: testEnv.DB };
function response(body: unknown, status = 200, headers: Record<string, string> = {}) { return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }); }

async function setActiveIndex(rows: Array<{ id: string; reference: string; name?: string }> = [], completedAt = new Date().toISOString()) {
  await testEnv.DB.prepare("DELETE FROM avantio_accommodation_reference_index").run();
  await testEnv.DB.prepare(`UPDATE avantio_accommodation_index_sync_state SET active_generation_id = 'active', building_generation_id = NULL, next_page_url = NULL, status = 'complete', completed_at = ?, processed_records = ?, processed_pages = 1, last_error_code = NULL WHERE singleton_id = 1`).bind(completedAt, rows.length).run();
  for (const row of rows) await testEnv.DB.prepare(`INSERT INTO avantio_accommodation_reference_index (generation_id, accommodation_id, external_reference, name, remote_status, inspected_at) VALUES ('active', ?, ?, ?, 'ENABLED', ?)`).bind(row.id, row.reference, row.name ?? row.reference, completedAt).run();
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await testEnv.DB.prepare("DELETE FROM avantio_accommodation_reference_index").run();
  await testEnv.DB.prepare(`UPDATE avantio_accommodation_index_sync_state SET active_generation_id = NULL, building_generation_id = NULL, next_page_url = NULL, status = 'idle', started_at = NULL, completed_at = NULL, processed_records = 0, processed_pages = 0, last_error_code = NULL WHERE singleton_id = 1`).run();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("AvantioApiGateway accommodation methods", () => {
  it.each([
    ["absolute", "https://provider.test/pms/v2/accommodations?cursor=abs&page=2", "https://provider.test/pms/v2/accommodations?cursor=abs&page=2"],
    ["root-relative", "/pms/v2/accommodations?cursor=root&page=2", "https://provider.test/pms/v2/accommodations?cursor=root&page=2"],
    ["query-only", "?cursor=query&page=2", "https://provider.test/pms/v2/accommodations?cursor=query&page=2"],
    ["path-relative", "accommodations?cursor=path&page=2", "https://provider.test/pms/v2/accommodations?cursor=path&page=2"],
  ])("normalizes a %s provider next link to a safe absolute cursor", async (_format, next, expected) => {
    const cursorEnv = { ...env, AVANTIO_BASE_URL: "https://provider.test/pms/v2" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ data: [], _links: { next } }))
      .mockResolvedValueOnce(response({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const gateway = new AvantioApiGateway(cursorEnv);
    const page = await gateway.getAccommodationsPage(null, 10);
    const continuation = await gateway.getAccommodationsPage(page.nextPageUrl, 10);

    expect(fetchMock.mock.calls[0][0]).toBe("https://provider.test/pms/v2/accommodations?pagination_size=10");
    expect(fetchMock.mock.calls[1][0]).toBe(expected);
    expect(page.nextPageUrl).toBe(expected);
    expect(continuation.nextPageUrl).toBeNull();
  });

  it("follows an absolute continuation without rewriting any provider cursor parameters", async () => {
    const cursorEnv = { ...env, AVANTIO_BASE_URL: "https://provider.test/pms/v2" };
    const cursor = "https://provider.test/pms/v2/accommodations?token=a%2Fb&cursor=x%2By&page=2&pagination_size=7&token=second";
    const fetchMock = vi.fn().mockResolvedValue(response({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await new AvantioApiGateway(cursorEnv).getAccommodationsPage(cursor, 10);

    expect(fetchMock).toHaveBeenCalledWith(cursor, expect.objectContaining({ method: "GET" }));
  });

  it.each([
    ["foreign origin", "https://evil.test/pms/v2/accommodations?page=2"],
    ["non-HTTPS", "http://provider.test/pms/v2/accommodations?page=2"],
    ["outside API base path", "https://provider.test/other/accommodations?page=2"],
    ["unparseable", "http://["],
  ])("rejects a %s continuation cursor before fetch", async (_label, cursor) => {
    const cursorEnv = { ...env, AVANTIO_BASE_URL: "https://provider.test/pms/v2" };
    const fetchMock = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetchMock);

    await expect(new AvantioApiGateway(cursorEnv).getAccommodationsPage(cursor, 10)).rejects.toMatchObject({
      kind: "temporarily_unavailable",
      code: "accommodation_index_cursor_invalid",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(cursor);
  });

  it("rejects an unsafe provider-returned next link without exposing it in diagnostics", async () => {
    const cursorEnv = { ...env, AVANTIO_BASE_URL: "https://provider.test/pms/v2" };
    const rejected = "https://evil.test/pms/v2/accommodations?secret-cursor=value";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ data: [], _links: { next: rejected } })));

    await expect(new AvantioApiGateway(cursorEnv).getAccommodationsPage(null, 10)).rejects.toMatchObject({ code: "accommodation_index_cursor_invalid" });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(rejected);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("secret-cursor");
  });

  it("queries only the fresh active D1 generation and compares case-sensitively", async () => {
    await setActiveIndex([{ id: "accommodation-123", reference: "NSC314" }]);
    const fetchMock = vi.fn().mockImplementation(async () => response({ data: rawWithExternalReference }));
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new AvantioApiGateway(env);
    expect(await gateway.findAccommodationsByExternalReference("NSC314")).toEqual([{ external_id: "accommodation-123", external_reference: "NSC314", label: "NSC314", remote_status: "ENABLED" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://provider.test/accommodations/accommodation-123");

    fetchMock.mockClear();
    expect(await gateway.findAccommodationsByExternalReference("nsc314")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a fresh complete zero match without any provider scan", async () => {
    await setActiveIndex();
    await testEnv.DB.prepare(`INSERT INTO avantio_accommodation_reference_index (generation_id, accommodation_id, external_reference, name, remote_status, inspected_at) VALUES ('old-generation', 'old-id', 'UNIQUE', 'Old', 'ENABLED', ?)`).bind(new Date().toISOString()).run();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await new AvantioApiGateway(env).findAccommodationsByExternalReference("UNIQUE")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["incomplete", null],
    ["stale", new Date(Date.now() - 901_000).toISOString()],
  ])("fails closed when the index is %s", async (_label, completedAt) => {
    if (completedAt) await setActiveIndex([], completedAt);
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(new AvantioApiGateway(env).findAccommodationsByExternalReference("NSC314")).rejects.toMatchObject({ kind: "temporarily_unavailable", code: "accommodation_index_refresh_required" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["building", "failed"] as const)("keeps a fresh active generation queryable while synchronization is %s", async (status) => {
    await setActiveIndex();
    await testEnv.DB.prepare("UPDATE avantio_accommodation_index_sync_state SET status = ?, building_generation_id = 'next'").bind(status).run();
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(new AvantioApiGateway(env).findAccommodationsByExternalReference("NSC314")).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("invalidates a positive index match when live detail no longer matches", async () => {
    await setActiveIndex([{ id: "accommodation-123", reference: "NSC314" }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ data: { ...rawWithExternalReference, externalReference: "CHANGED" } })));
    await expect(new AvantioApiGateway(env).findAccommodationsByExternalReference("NSC314")).rejects.toMatchObject({ kind: "temporarily_unavailable", code: "accommodation_index_refresh_required" });
  });

  it("verifies each of multiple exact indexed matches without enumerating unrelated accommodations", async () => {
    await setActiveIndex([{ id: "accommodation-123", reference: "NSC314" }, { id: "accommodation-789", reference: "NSC314" }]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ data: rawWithExternalReference }))
      .mockResolvedValueOnce(response({ data: { ...rawWithExternalReference, id: "accommodation-789" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await new AvantioApiGateway(env).findAccommodationsByExternalReference("NSC314")).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
