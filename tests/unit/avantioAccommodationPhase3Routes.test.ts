import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvantioApiGateway } from "../../src/apiGateways/avantio/getAppointments";
import { AvantioAccommodationService, emptyNormalized } from "../../src/integrations/avantio/accommodations";
import { productionCanonicalProperty } from "../fixtures/avantioAccommodationCreate";

const headers = { "content-type": "application/json", "x-api-key": "test-key" };
const request = { request_id: "11111111-1111-4111-8111-111111111111", property_id: "22222222-2222-4222-8222-222222222222", property_version: 1, canonical_schema_version: 1, property: productionCanonicalProperty };
function post(path: string, body: unknown, authenticated = true) { return SELF.fetch(`http://local.test${path}`, { method: "POST", headers: authenticated ? headers : { "content-type": "application/json" }, body: JSON.stringify(body) }); }

beforeEach(() => { vi.restoreAllMocks(); });

describe("Avantio accommodation Phase 3 routes", () => {
  it("returns ready and never calls the provider", async () => {
    const lookup = vi.spyOn(AvantioApiGateway.prototype, "findAccommodationsByExternalReference");
    const response = await post("/v1/avantio/accommodations/readiness", request);
    expect(response.status).toBe(200);
    expect(await response.json<any>()).toMatchObject({ success: true, operation: "readiness", outcome: "ready", contract_version: "worker-accommodation-v1" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each(["readiness", "create", "reconcile"])("preserves %s on validation failure", async (operation) => {
    const body = operation === "create" ? { ...request, job_id: "33333333-3333-4333-8333-333333333333", property: {} } : { ...request, property: {} };
    const response = await post(`/v1/avantio/accommodations/${operation}`, body);
    expect(response.status).toBe(422);
    expect(await response.json<any>()).toMatchObject({ success: false, operation, outcome: "not_ready" });
  });

  it("rejects sensitive nested keys without returning their values", async () => {
    const response = await post("/v1/avantio/accommodations/readiness", { ...request, property: { ...productionCanonicalProperty, legacy_metadata: { access_code: "never-returned" } } });
    const text = await response.text();
    expect(response.status).toBe(422); expect(text).toContain("sensitive_key_rejected"); expect(text).not.toContain("never-returned");
  });

  it("returns found_existing while creation is disabled and performs no POST", async () => {
    vi.spyOn(AvantioApiGateway.prototype, "findAccommodationsByExternalReference").mockResolvedValue([{ external_id: "existing", external_reference: "NSC314", label: "NSC314", remote_status: "ENABLED" }]);
    const create = vi.spyOn(AvantioApiGateway.prototype, "createAccommodation");
    const response = await post("/v1/avantio/accommodations/create", { ...request, job_id: "33333333-3333-4333-8333-333333333333" });
    expect(response.status).toBe(200); expect(await response.json<any>()).toMatchObject({ outcome: "found_existing", external_id: "existing" }); expect(create).not.toHaveBeenCalled();
  });

  it("returns create_disabled after a zero-match lookup and performs no POST", async () => {
    vi.spyOn(AvantioApiGateway.prototype, "findAccommodationsByExternalReference").mockResolvedValue([]);
    const create = vi.spyOn(AvantioApiGateway.prototype, "createAccommodation");
    const response = await post("/v1/avantio/accommodations/create", { ...request, job_id: "33333333-3333-4333-8333-333333333333" });
    expect(response.status).toBe(503); expect(await response.json<any>()).toMatchObject({ outcome: "create_disabled" }); expect(create).not.toHaveBeenCalled();
  });

  it("passes request, job, and property IDs only as create diagnostic context", async () => {
    const body = emptyNormalized("create", "provider_rejected", 1, "NSC314");
    body.errors.push({ code: "provider_http_400", message: "A Avantio rejeitou ou não conseguiu processar a solicitação.", canonical_path: null, provider_path: null, section: "provider" });
    const create = vi.spyOn(AvantioAccommodationService.prototype, "create").mockResolvedValue({ status: 422, body });

    const response = await post("/v1/avantio/accommodations/create", { ...request, job_id: "33333333-3333-4333-8333-333333333333" });

    expect(response.status).toBe(422);
    expect(create).toHaveBeenCalledWith(productionCanonicalProperty, 1, {
      requestId: request.request_id,
      jobId: "33333333-3333-4333-8333-333333333333",
      propertyId: request.property_id,
    });
    expect(JSON.stringify(await response.json())).not.toContain(request.request_id);
  });

  it.each([[[], "not_found", 200], [[{ external_id: "one", external_reference: "NSC314", label: null, remote_status: null }], "found_one", 200], [[{ external_id: "one", external_reference: "NSC314", label: null, remote_status: null }, { external_id: "two", external_reference: "NSC314", label: null, remote_status: null }], "found_multiple", 409]] as const)("reconciles exact matches", async (candidates, outcome, status) => {
    vi.spyOn(AvantioApiGateway.prototype, "findAccommodationsByExternalReference").mockResolvedValue(candidates as any);
    const create = vi.spyOn(AvantioApiGateway.prototype, "createAccommodation");
    const response = await post("/v1/avantio/accommodations/reconcile", request);
    expect(response.status).toBe(status); expect(await response.json<any>()).toMatchObject({ operation: "reconcile", outcome }); expect(create).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated access", async () => { expect((await post("/v1/avantio/accommodations/readiness", request, false)).status).toBe(401); });

  it("publishes explicit Phase 3 schemas without secrets", async () => {
    const response = await SELF.fetch("http://local.test/openapi.json", { headers: { "x-api-key": "test-key" } });
    const document = await response.json<any>(); const serialized = JSON.stringify(document);
    for (const path of ["readiness", "create", "reconcile"]) expect(document.paths).toHaveProperty(`/v1/avantio/accommodations/${path}`);
    expect(serialized).not.toContain("test-key"); expect(serialized).not.toContain("X-Avantio-Auth"); expect(serialized).not.toContain("avantio_payload");
  });
});
