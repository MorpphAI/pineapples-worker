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
  services: { ...canonicalProperty.services, wifi: { available: true, speed: null }, elevator: false },
};

export const knownGoodCreatePayload = {
  name: "NSC314", type: "APARTMENT", status: "ENABLED", purpose: "RENTAL", capacity: { min: 1, maxAdults: 2 },
  features: { accessibility: { elevator: false } },
  location: { door: "314", floor: "3", admin1: "RJ", number: "1241", resort: "Copacabana", address: "Avenida Exemplo", cityName: "Rio de Janeiro", postalCode: null, countryCode: "BR" },
  services: [{ type: "INTERNET_ACCESS" }],
  distribution: { bedrooms: [{ beds: [{ type: "QUEENSIZE", amount: 1 }], type: "BEDROOM", floor: 0 }], kitchens: { count: 1, type: "INDEPENDENT", cooktop: "GAS", appliances: ["COFFEE_MACHINE", "MICROWAVE", "FRIDGE"] }, bathrooms: [{}] },
  externalReference: "NSC314", surroundingsAndDistances: { descriptions: [] },
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
export const providerTemporaryError = { message: "Temporarily unavailable" };
