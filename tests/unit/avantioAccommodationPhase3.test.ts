import { describe, expect, it } from "vitest";
import {
  AvantioAccommodationCreateRequestSchema,
  CanonicalPropertyV1Schema,
  CreateResponseSchema,
  findSensitiveKeyPaths,
  mapCanonicalToAvantioCreate,
  payloadHash,
  ReadinessResponseSchema,
  readiness,
  ReconcileResponseSchema,
  summarizeAccommodationReferencePresence,
} from "../../src/integrations/avantio/accommodations";
import { canonicalProperty } from "../fixtures/canonicalPropertyV1";
import { knownGoodCreatePayload, productionCanonicalProperty, rawWithExternalReference, rawWithoutReference } from "../fixtures/avantioAccommodationCreate";

describe("Avantio accommodation contracts and mapping", () => {
  it("accepts canonical v1 and preserves nulls", () => {
    const parsed = CanonicalPropertyV1Schema.parse(canonicalProperty);
    expect(parsed.capacity.max_children).toBeNull();
    expect(parsed.services.wifi.available).toBeNull();
  });

  it("maps the production-shaped apartment into a valid create request", () => {
    const mapped = mapCanonicalToAvantioCreate(CanonicalPropertyV1Schema.parse(productionCanonicalProperty));
    expect(mapped.errors).toEqual([]);
    expect(mapped.payload).toEqual(knownGoodCreatePayload);
    expect(AvantioAccommodationCreateRequestSchema.parse(mapped.payload)).toEqual(knownGoodCreatePayload);
    expect(mapped.payload?.externalReference).toBe(productionCanonicalProperty.identification.code);
  });

  it("readiness can return ready with a deterministic payload hash", async () => {
    const result = await readiness(CanonicalPropertyV1Schema.parse(productionCanonicalProperty));
    expect(result.ready).toBe(true);
    expect(result.payload_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.errors).toEqual([]);
  });

  it.each([
    ["title_required", { identification: { ...productionCanonicalProperty.identification, title: null } }],
    ["max_adults_required", { capacity: { ...productionCanonicalProperty.capacity, max_adults: null } }],
    ["street_required", { address: { ...productionCanonicalProperty.address, street: null } }],
  ])("reports %s with a canonical path", async (code, section) => {
    const property = { ...productionCanonicalProperty, ...section };
    const result = await readiness(CanonicalPropertyV1Schema.parse(property));
    expect(result.ready).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code, canonical_path: expect.any(String), provider_path: expect.any(String) }));
  });

  it("reports unsupported property and bed mappings explicitly", () => {
    const unsupportedProperty = mapCanonicalToAvantioCreate({ ...productionCanonicalProperty, identification: { ...productionCanonicalProperty.identification, property_type: "castle" } } as any);
    expect(unsupportedProperty.errors).toContainEqual(expect.objectContaining({ code: "unsupported_provider_mapping", canonical_path: "identification.property_type" }));
    const unsupportedBed = mapCanonicalToAvantioCreate({ ...productionCanonicalProperty, capacity: { ...productionCanonicalProperty.capacity, beds: [{ ...productionCanonicalProperty.capacity.beds[0], bed_type: "hammock" }] } } as any);
    expect(unsupportedBed.errors).toContainEqual(expect.objectContaining({ code: "unsupported_provider_mapping", provider_path: "distribution.bedrooms[].beds[].type" }));
  });

  it("reports recursive sensitive paths without values", () => {
    expect(findSensitiveKeyPaths({ nested: [{ WiFi_Password: "do-not-log" }] })).toEqual(["nested[0].WiFi_Password"]);
  });

  it("hashes canonicalized payloads deterministically and preserves array order", async () => {
    expect(await payloadHash(knownGoodCreatePayload)).toBe("ee9750ab7fa91d937d3c4746f53fe9f4e743458a9a8fb81c5a28f6b9901b6c86");
    expect(await payloadHash({ b: [2, 1], a: 1 })).toBe(await payloadHash({ a: 1, b: [2, 1] }));
    expect(await payloadHash({ a: [1, 2] })).not.toBe(await payloadHash({ a: [2, 1] }));
  });

  it("summarizes raw reference presence without leaking records", () => {
    expect(summarizeAccommodationReferencePresence([rawWithExternalReference, rawWithoutReference])).toEqual({ total: 2, with_externalReference: 1, with_registry_registerReference: 0 });
  });

  it("response schemas reject invalid operations and outcomes", () => {
    expect(CreateResponseSchema.safeParse({ operation: "create", outcome: "invented" }).success).toBe(false);
    expect(ReconcileResponseSchema.safeParse({ operation: "reconcile", outcome: "created" }).success).toBe(false);
    expect(ReadinessResponseSchema.safeParse({ operation: "validation", outcome: "ready" }).success).toBe(false);
  });
});
