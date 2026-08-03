import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const headers = { "content-type": "application/json", "x-api-key": "test-key" };
const property = {
  identification: { code: "PHASE3-NONEXISTENT", title: "Apartamento", property_type: "apartment", tier: "standard" },
  address: { postal_code: "20000-000", street: "Rua A", number: "1", city: "Rio", state: "RJ", country: "BR" },
  capacity: { max_adults: 2, max_children: null, area_sqm: 50, bedroom_count: 1, suite_count: 0, bathroom_count: 1, toilet_count: 0, rooms: 2, beds: null, sofa_bed: null },
  kitchen: { available: true, cooktop_type: null, frost_free_fridge: null, appliances: null, utensils: null },
  amenities: { bedroom: null, living_room: null, bathroom: null, general: null },
  services: { air_conditioning: null, wifi: { available: null, speed: null }, pets: null, parking: null, reception: null, self_check_in: null, elevator: null, keyholder_available: null, lock_type: null, water_heating: null, waste_disposal: null, existing_reservations: null },
  operational_notes: null,
  source: "phase3-smoke",
  warnings: [],
  legacy_metadata: null,
};
const request = { request_id: "11111111-1111-4111-8111-111111111111", property_id: "22222222-2222-4222-8222-222222222222", property_version: 8, canonical_schema_version: 1, property };

function post(path: string, body: unknown, authenticated = true) {
  return SELF.fetch(`http://local.test${path}`, { method: "POST", headers: authenticated ? headers : { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("Avantio accommodation Phase 3 read-only routes", () => {
  it("runs readiness for a valid-shaped canonical property", async () => {
    const response = await post("/v1/avantio/accommodations/readiness", request);
    const body = await response.json<any>();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, operation: "readiness", ready: false, contract_version: "unverified", payload_hash: null });
    expect(body.blocking_errors).toContainEqual(expect.objectContaining({ code: "contract_unavailable" }));
  });

  it("rejects a readiness request with missing canonical fields", async () => {
    const response = await post("/v1/avantio/accommodations/readiness", { ...request, property: { identification: property.identification } });
    expect(response.status).toBe(422);
    expect(await response.json<any>()).toMatchObject({ success: false, error: { code: "invalid_request" } });
  });

  it("does not query the provider when exact-reference lookup is unverified", async () => {
    const response = await post("/v1/avantio/accommodations/reconcile", request);
    expect(response.status).toBe(503);
    expect(await response.json<any>()).toMatchObject({ operation: "reconcile", error: { code: "external_reference_lookup_unavailable" } });
  });

  it("rejects unauthenticated access", async () => {
    const response = await post("/v1/avantio/accommodations/readiness", request, false);
    expect(response.status).toBe(401);
  });

  it("publishes all Phase 3 paths without secret values or provider payload examples", async () => {
    const response = await SELF.fetch("http://local.test/openapi.json", { headers: { "x-api-key": "test-key" } });
    expect(response.status).toBe(200);
    const document = await response.json<any>();
    expect(document.paths).toHaveProperty("/v1/avantio/accommodations/readiness");
    expect(document.paths).toHaveProperty("/v1/avantio/accommodations/create");
    expect(document.paths).toHaveProperty("/v1/avantio/accommodations/reconcile");
    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain("test-key");
    expect(serialized).not.toContain("X-Avantio-Auth");
    expect(serialized).not.toContain("avantio_payload");
  });
});
