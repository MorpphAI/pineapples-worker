import { canonicalProperty } from "./canonicalPropertyV1";

export const productionCanonicalProperty = {
  ...canonicalProperty,
  identification: { ...canonicalProperty.identification, code: "NSC314", title: "NSC314", property_type: "apartment" as const },
  address: {
    ...canonicalProperty.address, street: "Avenida Exemplo", number: "1241", unit: "314", floor: "3", neighborhood: "Copacabana",
    city: "Rio de Janeiro", state: "RJ", postal_code: null, country: "BR", coordinates: null,
  },
  capacity: {
    ...canonicalProperty.capacity, max_adults: 2, max_children: null, area_sqm: null, bathroom_count: 1,
    beds: [{ position: 1, bed_type: "queen" as const, quantity: 1, is_suite: false, raw_label: null }],
  },
  kitchen: { ...canonicalProperty.kitchen, available: true, layout_type: "independent" as const, cooktop_type: "gas" as const, appliances: ["Cafeteira", "Micro-ondas", "Geladeira"] },
  amenities: { ...canonicalProperty.amenities, descriptors: ["modern" as const] },
  services: { ...canonicalProperty.services, wifi: { available: true, speed: null }, elevator: false },
};

export const knownGoodCreatePayload = {
  name: "NSC314", type: "APARTMENT", status: "DISABLED", purpose: "RENTAL", pricingModel: "SEASONAL_RATES", capacity: { min: 1, maxAdults: 2 },
  features: { accessibility: { elevator: false } },
  location: { addrType: "STREET", door: "314", floor: "3", admin1: "RJ", number: "1241", resort: "Copacabana", address: "Avenida Exemplo", cityName: "Rio de Janeiro", countryCode: "BR" },
  registryData: { legalEntityId: null, managedBy: "PRIVATE", registerReference: "NSC314" },
  services: [
    { type: "INTERNET_ACCESS", accessType: "WIFI", available: true, displayMode: "VISIBLE_INCLUDED", terms: { additionalPrice: { amount: 0, currency: "BRL", paymentType: "INCLUDED" }, application: { rule: "MANDATORY_ALWAYS", comparison: { type: "GREATER", value: 0 }, quantity: 0 } } },
    { type: "FINAL_CLEAN", available: true, displayMode: "VISIBLE_ITEMIZED", terms: { additionalPrice: { amount: 0, currency: "BRL", paymentType: "INCLUDED" }, application: { rule: "MANDATORY_ALWAYS", comparison: { type: "GREATER", value: 0 }, quantity: 0 } } },
  ],
  distribution: { bedrooms: [{ beds: [{ type: "QUEENSIZE", amount: 1 }], type: "BEDROOM", floor: 0 }], kitchens: { count: 1, type: "INDEPENDENT", cooktop: "GAS", appliances: ["COFFEE_MACHINE", "MICROWAVE", "FRIDGE"] }, bathrooms: [{ count: 1, type: "WITH_SHOWER" }] },
  externalReference: "NSC314", surroundingsAndDistances: { descriptions: ["MODERN"] },
};

export const n8nReferenceCanonicalProperty = {
  ...productionCanonicalProperty,
  identification: { ...productionCanonicalProperty.identification, code: "PARITY-AVANTIO-01" },
  address: {
    ...productionCanonicalProperty.address,
    postal_code: "22.050-002",
    coordinates: { latitude: -22.9711, longitude: -43.1822 },
  },
  capacity: { ...productionCanonicalProperty.capacity, max_adults: 4, max_children: 2, bathroom_count: 2 },
  kitchen: { ...productionCanonicalProperty.kitchen, appliances: ["Geladeira", "Micro-ondas", "Cafeteira"] },
  services: {
    ...productionCanonicalProperty.services,
    air_conditioning: { available: true, areas: "Todos os ambientes" },
    wifi: { available: true, speed: null },
    pets: { allowed: false, notes: null },
    water_heating: "electric" as const,
    elevator: true,
  },
  amenities: {
    ...productionCanonicalProperty.amenities,
    bedroom: ["Ferro de passar", "Tábua de passar", "Smart TV", "Blackout", "Cabide", "Travesseiro"],
    living_room: ["Ventilador", "Mesa de jantar", "TV a cabo", "Cortina"],
    bathroom: ["Secador de cabelo", "Ducha higiênica"],
    general: ["Fechadura eletrônica", "Protetor de colchão", "Manta", "Talher inox", "Jogo americano"],
    descriptors: ["modern" as const],
  },
};

export const createSuccess = { data: { id: "accommodation-123", status: "ENABLED" } };
export const createSuccessMissingId = { data: { status: "ENABLED" } };
export const rawWithExternalReference = { id: "accommodation-123", name: "NSC314", status: "ENABLED", externalReference: "NSC314", galleryId: "gallery", location: {} };
export const rawWithoutReference = { id: "accommodation-456", name: "Other", status: "ENABLED", galleryId: "gallery", location: {} };
export const multipleExactMatches = [rawWithExternalReference, { ...rawWithExternalReference, id: "accommodation-789" }];
export const providerValidationError = { errors: [{ field: "location.address", message: "Invalid address" }] };
export const providerValidationTreeError = {
  message: "Some fields contain errors. See details for information about failed constraints.",
  details: [
    {
      property: "distribution",
      children: [
        {
          property: "bathrooms",
          children: [
            {
              property: "0",
              children: [
                {
                  property: "type",
                  constraints: {
                    isDefined: "type should not be null",
                    isEnum: "type must be one of the allowed values",
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
export const providerFieldMapArrayError = {
  error: "Bad Request",
  message: "Some fields contain errors. See details for information about failed constraints.",
  details: {
    "distribution.bathrooms[0].type": ["type should not be empty"],
  },
};
export const providerNestedFieldMapError = {
  error: "Bad Request",
  message: "Some fields contain errors. See details for information about failed constraints.",
  details: {
    distribution: {
      bathrooms: {
        "0": {
          type: ["type should not be empty"],
        },
      },
    },
  },
};
export const providerFieldRuleMapError = {
  details: {
    "distribution.bathrooms[0].type": {
      isDefined: "type is required",
      isEnum: "type must contain an allowed value",
    },
  },
};
export const providerFieldMapListError = {
  details: [
    { "location.address": ["address is required"] },
    { "capacity.maxAdults": "must be greater than zero" },
  ],
};
export const providerConstraintDescriptorError = {
  error: "Bad Request",
  message: "Some fields contain errors. See details for information about failed constraints.",
  details: {
    "capacity.maxAdults": {
      min: 1,
      max: 20,
      required: true,
      integer: true,
      nullable: false,
      invalid: true,
    },
  },
};
export const providerKitchenTypeConstraintError = {
  details: {
    "distribution.kitchens.type": {
      in: ["AMERICAN", "INDEPENDENT"],
    },
  },
};
export const providerKitchenApplianceConstraintError = {
  details: {
    "distribution.kitchens.appliances": {
      in: [
        "FRIDGE", "FREEZER", "OVEN", "MICROWAVE", "FRYER", "TOASTER", "COFFEE_MACHINE", "TABLEWARE",
        "KITCHEN_UTENSILS", "DISHWASHER", "WASHING_MACHINE", "DRYER", "JUICE_SQUEEZER", "ELECTRIC_KETTLE",
      ],
    },
  },
};
export const providerTemporaryError = { message: "Temporarily unavailable" };
