import { SELF } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { AvantioApiGateway } from "../../src/apiGateways/avantio/getAppointments";
import { canonicalProperty } from "../fixtures/canonicalPropertyV1";

const headers = { "content-type": "application/json", "x-api-key": "test-key" };
const request = { request_id: "11111111-1111-4111-8111-111111111111", property_id: "22222222-2222-4222-8222-222222222222", property_version: 1, canonical_schema_version: 1, property: canonicalProperty };

function post(path: string, body: unknown, authenticated = true) {
  return SELF.fetch(`http://local.test${path}`, { method: "POST", headers: authenticated ? headers : { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("Avantio accommodation Phase 3 routes", () => {
  it("returns deterministic not_ready diagnostics for a valid canonical request", async () => {
    const response = await post("/v1/avantio/accommodations/readiness", request);
    const body = await response.json<any>();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, operation: "readiness", outcome: "not_ready", contract_version: "worker-accommodation-v1", property_version: 1, payload_hash: null, provider_request_id: null });
    expect(body.errors).toContainEqual(expect.objectContaining({ code: "provider_create_model_unavailable" }));
  });

  it("returns canonical paths for structurally missing fields", async () => {
    const response = await post("/v1/avantio/accommodations/readiness", { ...request, property: { identification: canonicalProperty.identification } });
    expect(response.status).toBe(422);
    expect(await response.json<any>()).toMatchObject({ errors: [expect.objectContaining({ code: "invalid_canonical_request", canonical_path: "property.address" })] });
  });

  it("rejects sensitive nested keys with only the offending path", async () => {
    const response = await post("/v1/avantio/accommodations/readiness", { ...request, property: { ...canonicalProperty, legacy_metadata: { nested: [{ Access_Code: "never-returned" }] } } });
    const body = await response.json<any>();
    expect(response.status).toBe(422);
    expect(body.errors[0]).toMatchObject({ code: "sensitive_key_rejected", canonical_path: "property.legacy_metadata.nested[0].Access_Code" });
    expect(JSON.stringify(body)).not.toContain("never-returned");
  });

  it("returns create_disabled and performs no provider lookup or POST", async () => {
    const listSpy = vi.spyOn(AvantioApiGateway.prototype, "getAccommodations");
    const response = await post("/v1/avantio/accommodations/create", { ...request, job_id: "33333333-3333-4333-8333-333333333333" });
    expect(response.status).toBe(503);
    expect(await response.json<any>()).toMatchObject({ operation: "create", outcome: "create_disabled", external_reference: "PINE-1", contract_version: "worker-accommodation-v1" });
    expect(listSpy).not.toHaveBeenCalled();
  });

  it("fails reconciliation explicitly because no authoritative reference field exists", async () => {
    const listSpy = vi.spyOn(AvantioApiGateway.prototype, "getAccommodations");
    const response = await post("/v1/avantio/accommodations/reconcile", request);
    expect(response.status).toBe(503);
    expect(await response.json<any>()).toMatchObject({ operation: "reconcile", outcome: "temporarily_unavailable", errors: [expect.objectContaining({ code: "external_reference_field_unavailable" })] });
    expect(listSpy).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated access", async () => {
    expect((await post("/v1/avantio/accommodations/readiness", request, false)).status).toBe(401);
  });

  it("publishes all Phase 3 paths without secrets or raw payload examples", async () => {
    const response = await SELF.fetch("http://local.test/openapi.json", { headers: { "x-api-key": "test-key" } });
    expect(response.status).toBe(200);
    const document = await response.json<any>();
    for (const path of ["readiness", "create", "reconcile"]) expect(document.paths).toHaveProperty(`/v1/avantio/accommodations/${path}`);
    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain("test-key");
    expect(serialized).not.toContain("X-Avantio-Auth");
    expect(serialized).not.toContain("avantio_payload");
  });
});
