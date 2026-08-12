import { describe, expect, it } from "vitest";
import {
  AvantioAccommodationCreateRequestSchema,
  CanonicalPropertyV1Schema,
  mapCanonicalToAvantioCreate,
  readiness,
} from "../../src/integrations/avantio/accommodations";
import {
  knownGoodCreatePayload,
  n8nReferenceCanonicalProperty,
  productionCanonicalProperty,
} from "../fixtures/avantioAccommodationCreate";

/*
 * Intentional differences from the historical n8n mapper: the Worker never
 * supplies Rio coordinates, maxChildren=1, property/bed/kitchen/cooktop types,
 * MODERN, or BOILER without canonical evidence. It never maps Liquidificador
 * to JUICE_SQUEEZER, maps Air fryer to FRYER (newer evidence), and never adds
 * raw Wi-Fi credentials. These are safety constraints, not parity omissions.
 */
describe("Avantio create mapper n8n reference parity", () => {
  const property = CanonicalPropertyV1Schema.parse(n8nReferenceCanonicalProperty);
  const mapped = mapCanonicalToAvantioCreate(property);

  it("builds the provider-shaped golden payload from explicit canonical evidence", () => {
    expect(mapped.errors).toEqual([]);
    expect(mapped.payload).toMatchObject({
      status: "DISABLED",
      purpose: "RENTAL",
      pricingModel: "SEASONAL_RATES",
      capacity: { min: 1, maxAdults: 4, maxChildren: 2 },
      location: {
        addrType: "STREET",
        postalCode: "22050002",
        coordinates: { lat: "-22.9711", lon: "-43.1822" },
      },
      registryData: { legalEntityId: null, managedBy: "PRIVATE", registerReference: "PARITY-AVANTIO-01" },
      distribution: {
        bathrooms: [{ count: 2, type: "WITH_SHOWER", heater: "ELECTRIC" }],
        kitchens: {
          count: 1,
          type: "INDEPENDENT",
          cooktop: "GAS",
          appliances: ["FRIDGE", "MICROWAVE", "COFFEE_MACHINE"],
        },
      },
      surroundingsAndDistances: { descriptions: ["MODERN"] },
    });
    expect(AvantioAccommodationCreateRequestSchema.parse(mapped.payload)).toEqual(mapped.payload);
  });

  it("ports only explicitly selected feature labels and TV configuration", () => {
    expect(mapped.payload?.features).toMatchObject({
      accessibility: { elevator: true },
      iron: true,
      ironingBoard: true,
      hairDryer: true,
      hasFan: true,
      diningTable: true,
      blackout: true,
      curtains: true,
      hangers: true,
      electronicLock: true,
      bidet: true,
      mattressProtector: true,
      blanket: true,
      pillow: true,
      cutlery: true,
      dinnerware: true,
      tvConfiguration: { hasSmartTv: true, hasCableTv: true },
    });
  });

  it("ports AC, Wi-Fi, pets, and explicit final-clean policy with shared terms", () => {
    expect(mapped.payload?.services.map((service) => service.type)).toEqual([
      "AIR_CONDITIONED", "INTERNET_ACCESS", "PETS_ALLOWED", "FINAL_CLEAN",
    ]);
    expect(mapped.payload?.services).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "AIR_CONDITIONED", airConditionedType: "YES_ALL_THE_ACCOMMODATION", available: true, displayMode: "VISIBLE_INCLUDED" }),
      expect.objectContaining({ type: "INTERNET_ACCESS", accessType: "WIFI", available: true, displayMode: "VISIBLE_INCLUDED" }),
      expect.objectContaining({ type: "PETS_ALLOWED", available: false, displayMode: "VISIBLE_INCLUDED" }),
      expect.objectContaining({ type: "FINAL_CLEAN", available: true, displayMode: "VISIBLE_ITEMIZED" }),
    ]));
    for (const service of mapped.payload?.services ?? []) {
      expect(service.terms).toEqual({
        additionalPrice: { amount: 0, currency: "BRL", paymentType: "INCLUDED" },
        application: { rule: "MANDATORY_ALWAYS", comparison: { type: "GREATER", value: 0 }, quantity: 0 },
      });
    }
    const pets = mapped.payload?.services.find((service) => service.type === "PETS_ALLOWED");
    expect(pets).not.toHaveProperty("maxWeight");
    expect(pets).not.toHaveProperty("dangerousAllowed");
    expect(JSON.stringify(mapped.payload)).not.toMatch(/password|network/i);
  });

  it.each([
    ["Todos os ambientes", "YES_ALL_THE_ACCOMMODATION"],
    ["Somente quartos", "YES_ONLY_IN_BEDROOMS"],
    ["Somente sala", "YES_ONLY_LOUNGE_ROOM"],
    ["Sala e alguns quartos", "YES_IN_THE_LIVING_ROOM_AND_IN_SOME_BEDROOMS"],
  ] as const)("maps AC area %s to %s", (areas, expectedType) => {
    const candidate = CanonicalPropertyV1Schema.parse({
      ...productionCanonicalProperty,
      services: { ...productionCanonicalProperty.services, air_conditioning: { available: true, areas } },
    });
    const service = mapCanonicalToAvantioCreate(candidate).payload?.services.find((entry) => entry.type === "AIR_CONDITIONED");
    expect(service).toMatchObject({ airConditionedType: expectedType, available: true });
  });

  it.each([
    ["gas", "BOILER"],
    ["electric", "ELECTRIC"],
    ["solar", "SOLAR"],
  ] as const)("maps explicit %s bathroom heating to %s", (canonicalHeater, providerHeater) => {
    const candidate = CanonicalPropertyV1Schema.parse({
      ...productionCanonicalProperty,
      services: { ...productionCanonicalProperty.services, water_heating: canonicalHeater },
    });
    expect(mapCanonicalToAvantioCreate(candidate).payload?.distribution.bathrooms).toEqual([
      { count: 1, type: "WITH_SHOWER", heater: providerHeater },
    ]);
  });

  it.each([null, "none"] as const)("does not invent a bathroom heater for %s", (waterHeating) => {
    const candidate = CanonicalPropertyV1Schema.parse({
      ...productionCanonicalProperty,
      services: { ...productionCanonicalProperty.services, water_heating: waterHeating },
    });
    expect(mapCanonicalToAvantioCreate(candidate).payload?.distribution.bathrooms).toEqual([{ count: 1, type: "WITH_SHOWER" }]);
  });

  it("rejects the historical empty bathroom shape", () => {
    const invalid = structuredClone(knownGoodCreatePayload) as any;
    invalid.distribution.bathrooms = [{}, {}];
    expect(AvantioAccommodationCreateRequestSchema.safeParse(invalid).success).toBe(false);
  });

  it("omits invalid CEP, coordinates, maxChildren, features, and optional services rather than defaulting", () => {
    const candidate = CanonicalPropertyV1Schema.parse({
      ...productionCanonicalProperty,
      address: { ...productionCanonicalProperty.address, postal_code: "invalid", coordinates: null },
      capacity: { ...productionCanonicalProperty.capacity, max_children: null },
      amenities: { ...productionCanonicalProperty.amenities, bedroom: [], living_room: [], bathroom: [], general: [] },
      services: {
        ...productionCanonicalProperty.services,
        air_conditioning: { available: false, areas: null },
        wifi: { available: false, speed: null },
        pets: { allowed: null, notes: null },
        elevator: null,
      },
    });
    const payload = mapCanonicalToAvantioCreate(candidate).payload;
    expect(payload?.location).not.toHaveProperty("postalCode");
    expect(payload?.location).not.toHaveProperty("coordinates");
    expect(payload?.capacity).not.toHaveProperty("maxChildren");
    expect(payload).not.toHaveProperty("features");
    expect(payload?.services.map((service) => service.type)).toEqual(["FINAL_CLEAN"]);
  });

  it("blocks AC without an explicit supported area instead of defaulting to all accommodation", async () => {
    const candidate = CanonicalPropertyV1Schema.parse({
      ...productionCanonicalProperty,
      services: { ...productionCanonicalProperty.services, air_conditioning: { available: true, areas: null } },
    });
    const result = await readiness(candidate);
    expect(result.ready).toBe(false);
    expect(result.payload).toBeNull();
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "air_conditioning_areas_required",
      canonical_path: "services.air_conditioning.areas",
    }));
  });
});
