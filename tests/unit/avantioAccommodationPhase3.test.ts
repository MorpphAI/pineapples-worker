import { describe, expect, it } from "vitest";
import {
  CanonicalPropertyV1Schema,
  findSensitiveKeyPaths,
  mapCanonicalToAuthoritativeReadShape,
  payloadHash,
  readiness,
} from "../../src/integrations/avantio/accommodations";
import { canonicalProperty } from "../fixtures/canonicalPropertyV1";

describe("Avantio accommodation PineOS boundary", () => {
  it("accepts the exact canonical v1 schema and preserves unknown nulls", () => {
    const parsed = CanonicalPropertyV1Schema.parse(canonicalProperty);
    expect(parsed.capacity.max_children).toBeNull();
    expect(parsed.services.wifi.available).toBeNull();
  });

  it("rejects unsupported canonical enums", () => {
    expect(CanonicalPropertyV1Schema.safeParse({ ...canonicalProperty, identification: { ...canonicalProperty.identification, property_type: "castle" } }).success).toBe(false);
  });

  it("reports sensitive keys recursively and case-insensitively without values", () => {
    expect(findSensitiveKeyPaths({ property: canonicalProperty, nested: [{ WiFi_Password: "do-not-log" }] })).toEqual(["nested[0].WiFi_Password"]);
    expect(findSensitiveKeyPaths(canonicalProperty)).toEqual([]);
  });

  it("maps deterministically only into fields that exist in the authoritative read model", () => {
    const parsed = CanonicalPropertyV1Schema.parse(canonicalProperty);
    expect(mapCanonicalToAuthoritativeReadShape(parsed)).toEqual({
      name: "Apartamento",
      location: { countryCode: "BR", cityName: "Rio", postalCode: "20000-000", address: "Rua A", number: "1" },
    });
  });

  it("hashes recursively canonicalized mappings deterministically while preserving arrays", async () => {
    expect(await payloadHash({ b: [2, 1], a: 1 })).toBe(await payloadHash({ a: 1, b: [2, 1] }));
    expect(await payloadHash({ a: [1, 2] })).not.toBe(await payloadHash({ a: [2, 1] }));
  });

  it("returns field-level issues and authoritative contract gaps without defaults", () => {
    const parsed = CanonicalPropertyV1Schema.parse({ ...canonicalProperty, address: { ...canonicalProperty.address, city: null } });
    const result = readiness(parsed);
    expect(result.ready).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "city_required", canonical_path: "address.city", provider_path: "location.cityName" }),
      expect.objectContaining({ code: "provider_create_model_unavailable" }),
      expect.objectContaining({ code: "external_reference_field_unavailable", canonical_path: "identification.code" }),
    ]));
  });
});
