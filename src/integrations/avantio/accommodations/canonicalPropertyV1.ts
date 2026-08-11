import { z } from "zod";

const nullableText = z.string().nullable();
const triState = z.boolean().nullable();
const nonNegativeInteger = z.number().int().nonnegative().nullable();
const bedType = z.enum(["single", "double", "queen", "king", "bunk"]).nullable();

export const CanonicalPropertyV1Schema = z.object({
  identification: z.object({
    code: z.string().trim().min(1),
    title: nullableText,
    property_type: z.enum(["apartment", "house", "studio", "loft", "room"]).nullable(),
    tier: z.number().int().nullable(),
  }).strict(),
  address: z.object({
    postal_code: nullableText,
    street: nullableText,
    number: nullableText,
    unit: nullableText,
    floor: nullableText,
    neighborhood: nullableText,
    city: nullableText,
    state: nullableText,
    country: nullableText,
    coordinates: z.object({ latitude: z.number().finite(), longitude: z.number().finite() }).strict().nullable().optional(),
  }).strict(),
  capacity: z.object({
    max_adults: nonNegativeInteger,
    max_children: nonNegativeInteger,
    area_sqm: z.number().finite().nonnegative().nullable(),
    bedroom_count: nonNegativeInteger,
    suite_count: nonNegativeInteger,
    bathroom_count: nonNegativeInteger,
    toilet_count: nonNegativeInteger,
    rooms: z.array(z.string()),
    beds: z.array(z.object({
      position: z.number().int().positive(),
      bed_type: bedType,
      quantity: z.number().int().positive(),
      is_suite: z.boolean(),
      raw_label: nullableText.optional(),
    }).strict()),
    sofa_bed: z.object({ available: triState, bed_type: bedType, raw_label: nullableText.optional() }).strict(),
  }).strict(),
  kitchen: z.object({
    available: triState,
    layout_type: z.enum(["american", "independent"]).nullable().optional(),
    cooktop_type: z.enum(["gas", "electric", "induction"]).nullable(),
    frost_free_fridge: z.boolean(),
    appliances: z.array(z.string()),
    utensils: z.array(z.string()),
  }).strict(),
  amenities: z.object({ bedroom: z.array(z.string()), living_room: z.array(z.string()), bathroom: z.array(z.string()), general: z.array(z.string()) }).strict(),
  services: z.object({
    air_conditioning: z.object({ available: triState, areas: nullableText }).strict(),
    wifi: z.object({ available: triState, speed: nullableText }).strict(),
    pets: z.object({ allowed: triState, notes: nullableText }).strict(),
    parking: z.object({ available: triState, notes: nullableText }).strict(),
    reception: z.object({ available: z.boolean(), notes: nullableText, guest_registration: nullableText }).strict(),
    self_check_in: triState,
    elevator: triState,
    keyholder: z.object({ available: z.boolean() }).strict(),
    lock_type: z.enum(["electronic", "code", "key", "smart", "none"]).nullable(),
    water_heating: z.enum(["gas", "electric", "solar", "none"]).nullable(),
    waste_disposal: nullableText,
    existing_reservations: z.object({ present: z.boolean(), notes: nullableText }).strict(),
  }).strict(),
  operational_notes: nullableText,
  source: z.object({ origin: z.enum(["form", "legacy_property_data", "import", "unknown"]), captured_at: nullableText, schema_version: z.number().int().positive() }).strict(),
  warnings: z.array(z.string()),
  legacy_metadata: z.record(z.unknown()),
}).strict();

export type CanonicalPropertyV1 = z.infer<typeof CanonicalPropertyV1Schema>;

const sensitiveKeys = new Set([
  "password", "senha", "token", "authorization", "api_key", "cpf", "tax_id", "bank", "banking", "account",
  "account_number", "owner", "owner_document", "private_contact", "wifi_password", "lock_password", "access_code",
  "_avantio_payload", "avantio_payload",
]);

export function findSensitiveKeyPaths(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((entry, index) => findSensitiveKeyPaths(entry, `${path}[${index}]`));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
    const currentPath = path ? `${path}.${key}` : key;
    return sensitiveKeys.has(key.toLowerCase()) ? [currentPath] : findSensitiveKeyPaths(nested, currentPath);
  });
}

export function containsProhibitedKey(value: unknown): boolean {
  return findSensitiveKeyPaths(value).length > 0;
}

export const CommonRequestSchema = z.object({
  request_id: z.string().uuid(), property_id: z.string().uuid(), property_version: z.number().int().nonnegative(), canonical_schema_version: z.literal(1), property: CanonicalPropertyV1Schema,
}).strict();
export const CreateRequestSchema = CommonRequestSchema.extend({ job_id: z.string().uuid() }).strict();
export type CommonRequest = z.infer<typeof CommonRequestSchema>;
export type CreateRequest = z.infer<typeof CreateRequestSchema>;
