import { CanonicalPropertyV1 } from "./canonicalPropertyV1";
import { AvantioAccommodationCreateRequest, AvantioAccommodationCreateRequestSchema } from "./createContract";
import type { ReadinessIssue } from "./readiness";

const propertyTypes = { apartment: "APARTMENT", house: "HOUSE", studio: "STUDIO", loft: "APARTMENT", room: "RENT_BY_ROOM" } as const;
const bedTypes = { single: "INDIVIDUAL", double: "DOUBLE", queen: "QUEENSIZE", king: "KINGSIZE", bunk: "BUNK" } as const;
const cooktops = { gas: "GAS", electric: "ELECTRIC", induction: "INDUCTION" } as const;

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
    if (bed.bed_type !== "queen") warnings.push(migrationWarning(`capacity.beds[${bed.position - 1}].bed_type`, "distribution.bedrooms[].beds[].type"));
    const group = bedrooms.get(bed.position) ?? [];
    group.push({ type: mapped, amount: bed.quantity });
    bedrooms.set(bed.position, group);
  }
  if (property.capacity.sofa_bed.available === true) {
    warnings.push(issue("sofa_bed_provider_mapping_deferred", "O sofá-cama foi preservado apenas no contrato canônico até que o mapeamento do provedor seja verificado.", "capacity.sofa_bed", "distribution.bedrooms", "capacity"));
  }
  if (bedrooms.size === 0) errors.push(issue("bedrooms_required", "Informe ao menos uma cama com tipo conhecido.", "capacity.beds", "distribution.bedrooms", "capacity"));

  let coordinates: { lat: string; lon: string } | undefined;
  if (property.address.coordinates) {
    const { latitude, longitude } = property.address.coordinates;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) errors.push(issue("invalid_coordinates", "As coordenadas estão fora dos limites válidos.", "address.coordinates", "location.coordinates", "address"));
    else coordinates = { lat: String(latitude), lon: String(longitude) };
  }

  let kitchen: { count: number; cooktop?: typeof cooktops[keyof typeof cooktops]; appliances?: string[] } | undefined;
  if (property.kitchen.available === true) {
    kitchen = { count: 1 };
    if (property.kitchen.cooktop_type) {
      const mapped = cooktops[property.kitchen.cooktop_type as keyof typeof cooktops];
      if (!mapped) errors.push(issue("unsupported_provider_mapping", "Cooktop sem mapeamento Avantio suportado.", "kitchen.cooktop_type", "distribution.kitchens.cooktop", "kitchen"));
      else {
        kitchen.cooktop = mapped;
        if (property.kitchen.cooktop_type !== "gas") warnings.push(migrationWarning("kitchen.cooktop_type", "distribution.kitchens.cooktop"));
      }
    }
    if (property.kitchen.appliances.length > 0) kitchen.appliances = [...property.kitchen.appliances];
  }

  if (errors.length > 0 || !providerPropertyType || property.identification.title === null || property.capacity.max_adults === null || property.capacity.bathroom_count === null || property.address.street === null || property.address.number === null || property.address.city === null || property.address.state === null || property.address.country === null) {
    return { payload: null, errors, warnings };
  }

  const payload = {
    name: property.identification.title,
    type: providerPropertyType,
    status: "ENABLED",
    purpose: "RENTAL",
    capacity: { min: 1, maxAdults: property.capacity.max_adults, ...(property.capacity.max_children !== null ? { maxChildren: property.capacity.max_children } : {}) },
    ...(property.services.elevator !== null ? { features: { accessibility: { elevator: property.services.elevator } } } : {}),
    location: {
      ...(property.address.unit !== null ? { door: property.address.unit } : {}),
      ...(property.address.floor !== null ? { floor: property.address.floor } : {}),
      admin1: property.address.state,
      number: property.address.number,
      ...(property.address.neighborhood !== null ? { resort: property.address.neighborhood } : {}),
      address: property.address.street,
      cityName: property.address.city,
      postalCode: property.address.postal_code,
      countryCode: property.address.country,
      ...(coordinates ? { coordinates } : {}),
    },
    ...(property.services.wifi.available === true ? { services: [{ type: "INTERNET_ACCESS" as const }] } : {}),
    distribution: {
      bedrooms: [...bedrooms.entries()].sort(([a], [b]) => a - b).map(([, beds]) => ({ beds, type: "BEDROOM" as const, floor: 0 })),
      ...(kitchen ? { kitchens: kitchen } : {}),
      bathrooms: Array.from({ length: property.capacity.bathroom_count }, () => ({})),
    },
    externalReference: property.identification.code,
    surroundingsAndDistances: { descriptions: [] as string[] },
    ...(property.capacity.area_sqm !== null ? { area: { livingSpace: { amount: property.capacity.area_sqm, unit: "m2" as const } } } : {}),
  };
  const parsed = AvantioAccommodationCreateRequestSchema.safeParse(payload);
  if (!parsed.success) {
    for (const providerIssue of parsed.error.issues) errors.push(issue("provider_payload_invalid", "O payload mapeado não atende ao contrato Avantio verificado.", null, providerIssue.path.join("."), "provider_contract"));
    return { payload: null, errors, warnings };
  }
  return { payload: parsed.data, errors, warnings };
}
