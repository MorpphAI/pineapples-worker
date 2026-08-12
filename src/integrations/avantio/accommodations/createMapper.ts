import { CanonicalPropertyV1 } from "./canonicalPropertyV1";
import { AvantioAccommodationCreateRequest, AvantioAccommodationCreateRequestSchema } from "./createContract";
import type { ReadinessIssue } from "./readiness";

const propertyTypes = { apartment: "APARTMENT", house: "HOUSE", studio: "STUDIO", loft: "APARTMENT", room: "RENT_BY_ROOM" } as const;
const bedTypes = { single: "INDIVIDUAL", double: "DOUBLE", queen: "QUEENSIZE", king: "KINGSIZE", bunk: "BUNK" } as const;
const cooktops = { gas: "GAS", electric: "ELECTRIC", induction: "INDUCTION" } as const;
const kitchenTypes = { american: "AMERICAN", independent: "INDEPENDENT" } as const;
const kitchenAppliances = {
  "Cafeteira": "COFFEE_MACHINE",
  "Máq. de expresso": "COFFEE_MACHINE",
  "Torradeira": "TOASTER",
  "Micro-ondas": "MICROWAVE",
  "Forno": "OVEN",
  "Forninho": "OVEN",
  "Geladeira": "FRIDGE",
  "Freezer": "FREEZER",
  "Lava-louça": "DISHWASHER",
  "Chaleira elétrica": "ELECTRIC_KETTLE",
  "Máq. de lavar": "WASHING_MACHINE",
  "Máq. de secar": "DRYER",
  "Air fryer": "FRYER",
} as const;
const surroundingsDescriptions = {
  of_recent_construction: "OF_RECENT_CONSTRUCTION",
  modern: "MODERN",
  totally_equipped: "TOTALLY_EQUIPPED",
  new_furniture: "NEW_FURNITURE",
  kitchen_totally_equipped: "KITCHEN_TOTALLY_EQUIPPED",
  exterior: "EXTERIOR",
  very_bright: "VERY_BRIGHT",
  large: "LARGE",
  ample: "AMPLE",
  furnished_with_taste: "FURNISHED_WITH_TASTE",
  cozy: "COZY",
  sweet: "SWEET",
  beautiful: "BEAUTIFUL",
  comfortable: "COMFORTABLE",
} as const;
const bathroomHeaters = { gas: "BOILER", electric: "ELECTRIC", solar: "SOLAR" } as const;
const featureLabels = {
  "Ferro de passar": "iron",
  "Tábua de passar": "ironingBoard",
  "Secador de cabelo": "hairDryer",
  "Ventilador": "hasFan",
  "Mesa de jantar": "diningTable",
  "Blackout": "blackout",
  "Cortina": "curtains",
  "Cabide": "hangers",
  "Fechadura eletrônica": "electronicLock",
  "Ducha higiênica": "bidet",
  "Protetor de colchão": "mattressProtector",
  "Manta": "blanket",
  "Travesseiro": "pillow",
  "Talheres inox": "cutlery",
  "Talher inox": "cutlery",
  "Jogo americano": "dinnerware",
} as const;
const airConditioningAreas = {
  "Todos os ambientes": "YES_ALL_THE_ACCOMMODATION",
  "Somente quartos": "YES_ONLY_IN_BEDROOMS",
  "Somente sala": "YES_ONLY_LOUNGE_ROOM",
  "Sala e alguns quartos": "YES_IN_THE_LIVING_ROOM_AND_IN_SOME_BEDROOMS",
} as const;
const SERVICE_TERMS = {
  additionalPrice: { amount: 0 as const, currency: "BRL" as const, paymentType: "INCLUDED" as const },
  application: {
    rule: "MANDATORY_ALWAYS" as const,
    comparison: { type: "GREATER" as const, value: 0 as const },
    quantity: 0 as const,
  },
};

function serviceTerms() {
  return {
    additionalPrice: { ...SERVICE_TERMS.additionalPrice },
    application: { ...SERVICE_TERMS.application, comparison: { ...SERVICE_TERMS.application.comparison } },
  };
}

type AvantioKitchenType = typeof kitchenTypes[keyof typeof kitchenTypes];
type AvantioKitchenAppliance = typeof kitchenAppliances[keyof typeof kitchenAppliances] | "FRIDGE" | "KITCHEN_UTENSILS";

export type CreateMappingResult = { payload: AvantioAccommodationCreateRequest | null; errors: ReadinessIssue[]; warnings: ReadinessIssue[] };

function issue(code: string, message: string, canonical_path: string | null, provider_path: string | null, section: string | null): ReadinessIssue {
  return { code, message, canonical_path, provider_path, section };
}

function migrationWarning(canonicalPath: string, providerPath: string): ReadinessIssue {
  return issue("migration_derived_mapping", "Mapeamento baseado em evidência de migração, não no payload conectado principal.", canonicalPath, providerPath, canonicalPath.split(".")[0]);
}

function isBlankText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length === 0;
}

export function mapCanonicalToAvantioCreate(property: CanonicalPropertyV1): CreateMappingResult {
  const errors: ReadinessIssue[] = [];
  const warnings: ReadinessIssue[] = [];
  const canonicalDescriptors = property.amenities.descriptors;
  const mappedDescriptions = new Set(
    canonicalDescriptors?.map((descriptor) => surroundingsDescriptions[descriptor]) ?? [],
  );
  if (mappedDescriptions.size === 0) {
    errors.push(issue(
      "surroundings_descriptions_required",
      "Selecione ao menos uma característica descritiva do imóvel.",
      "amenities.descriptors",
      "surroundingsAndDistances.descriptions",
      "amenities",
    ));
  }
  const mappedAirConditioningType = property.services.air_conditioning.areas
    ? airConditioningAreas[property.services.air_conditioning.areas as keyof typeof airConditioningAreas]
    : undefined;
  if (property.services.air_conditioning.available === true && !mappedAirConditioningType) {
    errors.push(issue(
      "air_conditioning_areas_required",
      "Informe em quais ambientes o ar-condicionado está disponível.",
      "services.air_conditioning.areas",
      "services[].airConditionedType",
      "services",
    ));
  }
  const required: Array<[unknown, string, string, string, string]> = [
    [property.identification.title, "title_required", "Informe o título da acomodação.", "identification.title", "name"],
    [property.identification.property_type, "property_type_required", "Informe o tipo do imóvel.", "identification.property_type", "type"],
    [property.capacity.max_adults, "max_adults_required", "Informe a capacidade máxima de adultos.", "capacity.max_adults", "capacity.maxAdults"],
    [property.address.street, "street_required", "Informe a rua.", "address.street", "location.address"],
    [property.address.number, "number_required", "Informe o número.", "address.number", "location.number"],
    [property.address.city, "city_required", "Informe a cidade.", "address.city", "location.cityName"],
    [property.address.state, "state_required", "Informe o estado.", "address.state", "location.admin1"],
    [property.address.country, "country_required", "Informe o país.", "address.country", "location.countryCode"],
    [property.capacity.bathroom_count, "bathroom_count_required", "Informe a quantidade de banheiros.", "capacity.bathroom_count", "distribution.bathrooms"],
  ];
  for (const [value, code, message, canonicalPath, providerPath] of required) {
    if (value === null || isBlankText(value)) errors.push(issue(code, message, canonicalPath, providerPath, canonicalPath.split(".")[0]));
  }
  if (property.capacity.max_adults !== null && property.capacity.max_adults <= 0) {
    errors.push(issue("max_adults_required", "Informe uma capacidade máxima de adultos maior que zero.", "capacity.max_adults", "capacity.maxAdults", "capacity"));
  }
  if (property.capacity.bathroom_count !== null && property.capacity.bathroom_count <= 0) {
    errors.push(issue("bathroom_count_required", "Informe ao menos um banheiro.", "capacity.bathroom_count", "distribution.bathrooms", "capacity"));
  }
  if (property.address.country !== null && !/^[A-Z]{2}$/.test(property.address.country)) {
    errors.push(issue("invalid_country_code", "Informe um código de país válido com duas letras maiúsculas.", "address.country", "location.countryCode", "address"));
  }
  if (property.address.state !== null && (isBlankText(property.address.state) || !/^[\p{L}\p{N}][\p{L}\p{N} .'-]*$/u.test(property.address.state))) {
    errors.push(issue("invalid_admin1", "Informe um estado ou divisão administrativa válida.", "address.state", "location.admin1", "address"));
  }

  const canonicalPropertyType = property.identification.property_type as keyof typeof propertyTypes | null;
  const providerPropertyType = canonicalPropertyType ? propertyTypes[canonicalPropertyType] : undefined;
  if (canonicalPropertyType && !providerPropertyType) errors.push(issue("unsupported_provider_mapping", "Tipo de imóvel sem mapeamento Avantio suportado.", "identification.property_type", "type", "identification"));
  else if (canonicalPropertyType && canonicalPropertyType !== "apartment") warnings.push(migrationWarning("identification.property_type", "type"));

  const bedrooms = new Map<number, Array<{ type: typeof bedTypes[keyof typeof bedTypes]; amount: number }>>();
  for (const bed of property.capacity.beds) {
    if (!bed.bed_type) {
      errors.push(issue("unsupported_provider_mapping", "Tipo de cama desconhecido.", `capacity.beds[${bed.position - 1}].bed_type`, "distribution.bedrooms[].beds[].type", "capacity"));
      continue;
    }
    const mapped = bedTypes[bed.bed_type as keyof typeof bedTypes];
    if (!mapped) {
      errors.push(issue("unsupported_provider_mapping", "Tipo de cama sem mapeamento Avantio suportado.", `capacity.beds[${bed.position - 1}].bed_type`, "distribution.bedrooms[].beds[].type", "capacity"));
      continue;
    }
    const group = bedrooms.get(bed.position) ?? [];
    group.push({ type: mapped, amount: bed.quantity });
    bedrooms.set(bed.position, group);
  }
  if (property.capacity.sofa_bed.available === true) {
    const sofaBedType = property.capacity.sofa_bed.bed_type
      ? bedTypes[property.capacity.sofa_bed.bed_type]
      : undefined;
    if (sofaBedType) {
      const nextPosition = Math.max(0, ...bedrooms.keys()) + 1;
      bedrooms.set(nextPosition, [{ type: sofaBedType, amount: 1 }]);
    } else {
      warnings.push(issue("sofa_bed_provider_mapping_deferred", "O sofá-cama foi preservado apenas no contrato canônico até que o tipo possa ser mapeado.", "capacity.sofa_bed", "distribution.bedrooms", "capacity"));
    }
  }
  if (bedrooms.size === 0) errors.push(issue("bedrooms_required", "Informe ao menos uma cama com tipo conhecido.", "capacity.beds", "distribution.bedrooms", "capacity"));

  let coordinates: { lat: string; lon: string } | undefined;
  if (property.address.coordinates) {
    const { latitude, longitude } = property.address.coordinates;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) errors.push(issue("invalid_coordinates", "As coordenadas estão fora dos limites válidos.", "address.coordinates", "location.coordinates", "address"));
    else coordinates = { lat: String(latitude), lon: String(longitude) };
  }

  const hasKitchenEvidence = property.kitchen.available === true
    || property.kitchen.layout_type != null
    || property.kitchen.cooktop_type != null
    || property.kitchen.frost_free_fridge === true
    || property.kitchen.appliances.length > 0
    || property.kitchen.utensils.length > 0;
  let kitchen: { count: number; type: AvantioKitchenType; cooktop?: typeof cooktops[keyof typeof cooktops]; appliances?: AvantioKitchenAppliance[] } | undefined;
  if (hasKitchenEvidence) {
    const mappedKitchenType = property.kitchen.layout_type ? kitchenTypes[property.kitchen.layout_type] : undefined;
    if (!mappedKitchenType) {
      errors.push(issue(
        "kitchen_layout_type_required",
        "Informe se a cozinha é americana ou independente.",
        "kitchen.layout_type",
        "distribution.kitchens.type",
        "kitchen",
      ));
    } else {
      kitchen = { count: 1, type: mappedKitchenType };
    }

    if (property.kitchen.cooktop_type) {
      const mapped = cooktops[property.kitchen.cooktop_type as keyof typeof cooktops];
      if (!mapped) errors.push(issue("unsupported_provider_mapping", "Cooktop sem mapeamento Avantio suportado.", "kitchen.cooktop_type", "distribution.kitchens.cooktop", "kitchen"));
      else if (kitchen) {
        kitchen.cooktop = mapped;
        if (property.kitchen.cooktop_type !== "gas") warnings.push(migrationWarning("kitchen.cooktop_type", "distribution.kitchens.cooktop"));
      }
    }

    const mappedAppliances = new Set<AvantioKitchenAppliance>();
    property.kitchen.appliances.forEach((appliance, index) => {
      const mapped = kitchenAppliances[appliance as keyof typeof kitchenAppliances];
      if (mapped) mappedAppliances.add(mapped);
      else warnings.push(issue(
        "provider_appliance_unmapped",
        "Este eletrodoméstico não possui um equivalente Avantio confirmado.",
        `kitchen.appliances[${index}]`,
        "distribution.kitchens.appliances",
        "kitchen",
      ));
    });
    if (property.kitchen.frost_free_fridge === true) mappedAppliances.add("FRIDGE");
    if (property.kitchen.utensils.some((utensil) => utensil.trim().length > 0)) mappedAppliances.add("KITCHEN_UTENSILS");
    if (kitchen && mappedAppliances.size > 0) kitchen.appliances = [...mappedAppliances];
  }

  const amenityLabels = new Set([
    ...property.amenities.bedroom,
    ...property.amenities.living_room,
    ...property.amenities.bathroom,
    ...property.amenities.general,
  ]);
  const features: Record<string, unknown> = {};
  if (property.services.elevator !== null) features.accessibility = { elevator: property.services.elevator };
  for (const [label, providerFeature] of Object.entries(featureLabels)) {
    if (amenityLabels.has(label)) features[providerFeature] = true;
  }
  const hasSmartTv = amenityLabels.has("Smart TV");
  const hasCableTv = amenityLabels.has("TV a cabo");
  if (hasSmartTv || hasCableTv) {
    features.tvConfiguration = {
      ...(hasSmartTv ? { hasSmartTv: true } : {}),
      ...(hasCableTv ? { hasCableTv: true } : {}),
    };
  }

  const services: unknown[] = [];
  if (mappedAirConditioningType) {
    services.push({
      type: "AIR_CONDITIONED",
      airConditionedType: mappedAirConditioningType,
      available: true,
      displayMode: "VISIBLE_INCLUDED",
      terms: serviceTerms(),
    });
  }
  if (property.services.wifi.available === true) {
    services.push({ type: "INTERNET_ACCESS", accessType: "WIFI", available: true, displayMode: "VISIBLE_INCLUDED", terms: serviceTerms() });
  }
  if (property.services.pets.allowed !== null) {
    services.push({ type: "PETS_ALLOWED", available: property.services.pets.allowed, displayMode: "VISIBLE_INCLUDED", terms: serviceTerms() });
  }
  services.push({ type: "FINAL_CLEAN", available: true, displayMode: "VISIBLE_ITEMIZED", terms: serviceTerms() });

  const postalCodeDigits = property.address.postal_code?.replace(/\D/g, "") ?? "";
  const postalCode = postalCodeDigits.length === 8 ? postalCodeDigits : undefined;
  const heater = property.services.water_heating && property.services.water_heating !== "none"
    ? bathroomHeaters[property.services.water_heating]
    : undefined;

  if (errors.length > 0 || !providerPropertyType || property.identification.title === null || property.capacity.max_adults === null || property.capacity.bathroom_count === null || property.address.street === null || property.address.number === null || property.address.city === null || property.address.state === null || property.address.country === null) {
    return { payload: null, errors, warnings };
  }

  const payload = {
    name: property.identification.title,
    type: providerPropertyType,
    status: "DISABLED",
    purpose: "RENTAL",
    pricingModel: "SEASONAL_RATES",
    capacity: { min: 1, maxAdults: property.capacity.max_adults, ...(property.capacity.max_children !== null ? { maxChildren: property.capacity.max_children } : {}) },
    ...(Object.keys(features).length > 0 ? { features } : {}),
    location: {
      addrType: "STREET",
      ...(property.address.unit !== null ? { door: property.address.unit } : {}),
      ...(property.address.floor !== null ? { floor: property.address.floor } : {}),
      admin1: property.address.state,
      number: property.address.number,
      ...(property.address.neighborhood !== null ? { resort: property.address.neighborhood } : {}),
      address: property.address.street,
      cityName: property.address.city,
      ...(postalCode ? { postalCode } : {}),
      countryCode: property.address.country,
      ...(coordinates ? { coordinates } : {}),
    },
    registryData: { legalEntityId: null, managedBy: "PRIVATE", registerReference: property.identification.code },
    services,
    distribution: {
      bedrooms: [...bedrooms.entries()].sort(([a], [b]) => a - b).map(([, beds]) => ({ beds, type: "BEDROOM" as const, floor: 0 })),
      ...(kitchen ? { kitchens: kitchen } : {}),
      bathrooms: [{ count: property.capacity.bathroom_count, type: "WITH_SHOWER", ...(heater ? { heater } : {}) }],
    },
    externalReference: property.identification.code,
    surroundingsAndDistances: { descriptions: [...mappedDescriptions] },
    ...(property.capacity.area_sqm !== null ? { area: { livingSpace: { amount: property.capacity.area_sqm, unit: "m2" as const } } } : {}),
  };
  const parsed = AvantioAccommodationCreateRequestSchema.safeParse(payload);
  if (!parsed.success) {
    for (const providerIssue of parsed.error.issues) errors.push(issue("provider_payload_invalid", "O payload mapeado não atende ao contrato Avantio verificado.", null, providerIssue.path.join("."), "provider_contract"));
    return { payload: null, errors, warnings };
  }
  return { payload: parsed.data, errors, warnings };
}
