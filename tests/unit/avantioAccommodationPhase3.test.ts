import { describe, expect, it } from "vitest";
import { CanonicalPropertyV1Schema, containsProhibitedKey, payloadHash, readiness } from "../../src/integrations/avantio/accommodations";

const property = {
  identification: { code: "PINE-1", title: "Apartamento", property_type: "apartment", tier: "standard" },
  address: { postal_code: "20000-000", street: "Rua A", number: "1", city: "Rio", state: "RJ", country: "BR" },
  capacity: { max_adults: 2, max_children: null, area_sqm: 50, bedroom_count: 1, suite_count: 0, bathroom_count: 1, toilet_count: 0, rooms: 2, beds: null, sofa_bed: null },
  kitchen: { available: true, cooktop_type: null, frost_free_fridge: null, appliances: null, utensils: null },
  amenities: { bedroom: null, living_room: null, bathroom: null, general: null },
  services: { air_conditioning: null, wifi: { available: null, speed: null }, pets: null, parking: null, reception: null, self_check_in: null, elevator: null, keyholder_available: null, lock_type: null, water_heating: null, waste_disposal: null, existing_reservations: null },
  source: "pineos", warnings: [],
};

describe("Avantio accommodation Phase 3 safety boundary", () => {
  it("preserves tri-state nulls and rejects unknown schema keys", () => {
    const parsed = CanonicalPropertyV1Schema.parse(property);
    expect(parsed.services.wifi.available).toBeNull();
    expect(CanonicalPropertyV1Schema.safeParse({ ...property, password: "no" }).success).toBe(false);
  });
  it("rejects sensitive keys recursively", () => {
    expect(containsProhibitedKey({ property, nested: { token: "secret" } })).toBe(true);
    expect(containsProhibitedKey(property)).toBe(false);
  });
  it("hashes equivalent objects deterministically", async () => {
    expect(await payloadHash({ b: [2, 1], a: 1 })).toBe(await payloadHash({ a: 1, b: [2, 1] }));
  });
  it("reports missing bathrooms and an unavailable provider contract without defaults", () => {
    const parsed = CanonicalPropertyV1Schema.parse({ ...property, capacity: { ...property.capacity, bathroom_count: null } });
    const result = readiness(parsed);
    expect(result.ready).toBe(false);
    expect(result.blocking_errors.map((error) => error.code)).toEqual(expect.arrayContaining(["bathroom_count_required", "contract_unavailable"]));
  });
});
