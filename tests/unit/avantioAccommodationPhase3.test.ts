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
    expect(parsed.kitchen.layout_type).toBeUndefined();
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
    ["american", "AMERICAN"],
    ["independent", "INDEPENDENT"],
  ] as const)("maps kitchen layout %s to %s", (layoutType, providerType) => {
    const property = CanonicalPropertyV1Schema.parse({
      ...productionCanonicalProperty,
      kitchen: { ...productionCanonicalProperty.kitchen, layout_type: layoutType },
    });
    expect(mapCanonicalToAvantioCreate(property).payload?.distribution.kitchens?.type).toBe(providerType);
  });

  it("requires a layout type when any kitchen evidence exists", async () => {
    const property = CanonicalPropertyV1Schema.parse({
      ...productionCanonicalProperty,
      kitchen: { ...productionCanonicalProperty.kitchen, layout_type: null },
    });
    const result = await readiness(property);
    expect(result.ready).toBe(false);
    expect(result.payload).toBeNull();
    expect(result.errors).toContainEqual({
      code: "kitchen_layout_type_required",
      message: "Informe se a cozinha é americana ou independente.",
      canonical_path: "kitchen.layout_type",
      provider_path: "distribution.kitchens.type",
      section: "kitchen",
    });
  });

  it("omits kitchens when there is no kitchen evidence", () => {
    const property = CanonicalPropertyV1Schema.parse({
      ...productionCanonicalProperty,
      kitchen: {
        available: false,
        layout_type: null,
        cooktop_type: null,
        frost_free_fridge: false,
        appliances: [],
        utensils: [],
      },
    });
    const mapped = mapCanonicalToAvantioCreate(property);
    expect(mapped.errors).toEqual([]);
    expect(mapped.payload?.distribution).not.toHaveProperty("kitchens");
  });

  it.each([
    ["Cafeteira", "COFFEE_MACHINE"],
    ["Máq. de expresso", "COFFEE_MACHINE"],
    ["Torradeira", "TOASTER"],
    ["Micro-ondas", "MICROWAVE"],
    ["Geladeira", "FRIDGE"],
    ["Freezer", "FREEZER"],
    ["Forno", "OVEN"],
    ["Forninho", "OVEN"],
    ["Lava-louça", "DISHWASHER"],
    ["Chaleira elétrica", "ELECTRIC_KETTLE"],
    ["Máq. de lavar", "WASHING_MACHINE"],
    ["Máq. de secar", "DRYER"],
    ["Air fryer", "FRYER"],
  ] as const)("maps canonical appliance %s to %s", (canonicalAppliance, providerAppliance) => {
    const property = CanonicalPropertyV1Schema.parse({
      ...productionCanonicalProperty,
      kitchen: { ...productionCanonicalProperty.kitchen, appliances: [canonicalAppliance] },
    });
    const kitchen = mapCanonicalToAvantioCreate(property).payload?.distribution.kitchens;
    expect(kitchen?.appliances).toEqual([providerAppliance]);
    expect(kitchen?.appliances).not.toContain(canonicalAppliance);
  });

  it("adds confirmed generic appliances from fridge and utensil evidence", () => {
    const property = CanonicalPropertyV1Schema.parse({
      ...productionCanonicalProperty,
      kitchen: {
        ...productionCanonicalProperty.kitchen,
        appliances: [],
        frost_free_fridge: true,
        utensils: ["Panela"],
      },
    });
    expect(mapCanonicalToAvantioCreate(property).payload?.distribution.kitchens?.appliances).toEqual(["FRIDGE", "KITCHEN_UTENSILS"]);
  });

  it("deduplicates appliances mapped from multiple canonical signals", () => {
    const property = CanonicalPropertyV1Schema.parse({
      ...productionCanonicalProperty,
      kitchen: {
        ...productionCanonicalProperty.kitchen,
        appliances: ["Cafeteira", "Máq. de expresso", "Geladeira", "Geladeira"],
        frost_free_fridge: true,
        utensils: ["Panela", "Espátula"],
      },
    });
    expect(mapCanonicalToAvantioCreate(property).payload?.distribution.kitchens?.appliances).toEqual([
      "COFFEE_MACHINE",
      "FRIDGE",
      "KITCHEN_UTENSILS",
    ]);
  });

  it.each(["Liquidificador", "Chaleira", "Sanduicheira", "Adega", "Filtro de água", "Frigobar"])(
    "warns and omits unsupported appliance %s",
    (canonicalAppliance) => {
      const property = CanonicalPropertyV1Schema.parse({
        ...productionCanonicalProperty,
        kitchen: { ...productionCanonicalProperty.kitchen, appliances: [canonicalAppliance] },
      });
      const mapped = mapCanonicalToAvantioCreate(property);
      expect(mapped.errors).toEqual([]);
      expect(mapped.payload?.distribution.kitchens?.appliances).toBeUndefined();
      expect(mapped.warnings).toContainEqual({
        code: "provider_appliance_unmapped",
        message: "Este eletrodoméstico não possui um equivalente Avantio confirmado.",
        canonical_path: "kitchen.appliances[0]",
        provider_path: "distribution.kitchens.appliances",
        section: "kitchen",
      });
    },
  );

  it("never places raw canonical appliance labels in the provider payload", () => {
    const property = CanonicalPropertyV1Schema.parse({
      ...productionCanonicalProperty,
      kitchen: {
        ...productionCanonicalProperty.kitchen,
        appliances: ["Cafeteira", "Micro-ondas", "Geladeira", "Liquidificador", "Chaleira"],
      },
    });
    const appliances = mapCanonicalToAvantioCreate(property).payload?.distribution.kitchens?.appliances ?? [];
    expect(appliances).toEqual(["COFFEE_MACHINE", "MICROWAVE", "FRIDGE"]);
    expect(appliances).not.toContain("JUICE_SQUEEZER");
    expect(appliances).not.toContain("ELECTRIC_KETTLE");
  });

  it("rejects arbitrary provider kitchen type and appliance strings", () => {
    const invalidType = structuredClone(knownGoodCreatePayload) as any;
    invalidType.distribution.kitchens.type = "OPEN_PLAN";
    expect(AvantioAccommodationCreateRequestSchema.safeParse(invalidType).success).toBe(false);

    const invalidAppliance = structuredClone(knownGoodCreatePayload) as any;
    invalidAppliance.distribution.kitchens.appliances = ["Cafeteira"];
    expect(AvantioAccommodationCreateRequestSchema.safeParse(invalidAppliance).success).toBe(false);
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

  it.each([
    ["max_adults_required", { capacity: { ...productionCanonicalProperty.capacity, max_adults: 0 } }],
    ["bathroom_count_required", { capacity: { ...productionCanonicalProperty.capacity, bathroom_count: 0 } }],
    ["title_required", { identification: { ...productionCanonicalProperty.identification, title: "   " } }],
    ["street_required", { address: { ...productionCanonicalProperty.address, street: "\t" } }],
    ["invalid_country_code", { address: { ...productionCanonicalProperty.address, country: "br" } }],
    ["invalid_admin1", { address: { ...productionCanonicalProperty.address, state: "   " } }],
  ])("rejects unsafe readiness input with %s", async (code, section) => {
    const result = await readiness(CanonicalPropertyV1Schema.parse({ ...productionCanonicalProperty, ...section }));
    expect(result.ready).toBe(false);
    expect(result.payload).toBeNull();
    expect(result.errors).toContainEqual(expect.objectContaining({ code, canonical_path: expect.any(String), provider_path: expect.any(String) }));
  });

  it("defers sofa-bed mapping without emitting an extra provider bedroom", async () => {
    const property = CanonicalPropertyV1Schema.parse({
      ...productionCanonicalProperty,
      capacity: { ...productionCanonicalProperty.capacity, sofa_bed: { available: true, bed_type: "double", raw_label: "sofa bed" } },
    });
    const result = await readiness(property);
    expect(result.ready).toBe(true);
    expect(result.payload?.distribution.bedrooms).toEqual(knownGoodCreatePayload.distribution.bedrooms);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "sofa_bed_provider_mapping_deferred", canonical_path: "capacity.sofa_bed", provider_path: "distribution.bedrooms" }));
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
    expect(await payloadHash(knownGoodCreatePayload)).toBe("8896037b2965e73721349a649776aff662ef424097b7e4aa57597a6a68ba4916");
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
