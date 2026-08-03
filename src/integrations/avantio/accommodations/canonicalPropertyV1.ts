import { z } from "zod";

const triState = z.boolean().nullable();
const optionalText = z.string().trim().min(1).nullable().optional();
const nonNegative = z.number().finite().nonnegative().nullable();

export const CanonicalPropertyV1Schema = z.object({
  identification: z.object({ code: z.string().trim().min(1), title: z.string().trim().min(1), property_type: z.string().trim().min(1), tier: z.string().trim().min(1) }),
  address: z.object({ postal_code: z.string().trim().min(1), street: z.string().trim().min(1), number: z.string().trim().min(1), unit: optionalText, floor: optionalText, neighborhood: optionalText, city: z.string().trim().min(1), state: z.string().trim().min(1), country: z.string().trim().min(2), coordinates: z.object({ latitude: z.number().finite(), longitude: z.number().finite() }).nullable().optional() }),
  capacity: z.object({ max_adults: nonNegative, max_children: nonNegative, area_sqm: nonNegative, bedroom_count: nonNegative, suite_count: nonNegative, bathroom_count: nonNegative, toilet_count: nonNegative, rooms: nonNegative, beds: z.array(z.record(z.unknown())).nullable(), sofa_bed: triState }),
  kitchen: z.object({ available: triState, cooktop_type: optionalText, frost_free_fridge: triState, appliances: z.array(z.string()).nullable(), utensils: z.array(z.string()).nullable() }),
  amenities: z.object({ bedroom: z.array(z.string()).nullable(), living_room: z.array(z.string()).nullable(), bathroom: z.array(z.string()).nullable(), general: z.array(z.string()).nullable() }),
  services: z.object({ air_conditioning: triState, wifi: z.object({ available: triState, speed: optionalText }), pets: triState, parking: triState, reception: triState, self_check_in: triState, elevator: triState, keyholder_available: triState, lock_type: optionalText, water_heating: optionalText, waste_disposal: triState, existing_reservations: triState }),
  operational_notes: optionalText,
  source: z.string().trim().min(1),
  warnings: z.array(z.string()),
  legacy_metadata: z.record(z.unknown()).nullable().optional(),
}).strict();

export type CanonicalPropertyV1 = z.infer<typeof CanonicalPropertyV1Schema>;

const prohibited = new Set(["password", "senha", "token", "authorization", "tax_id", "cpf", "banking", "bank", "account", "owner", "private contact", "_avantio_payload", "avantio_payload"]);
export function containsProhibitedKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsProhibitedKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => prohibited.has(key.toLowerCase()) || containsProhibitedKey(nested));
}

export const CommonRequestSchema = z.object({ request_id: z.string().uuid(), property_id: z.string().uuid(), property_version: z.number().int().nonnegative(), canonical_schema_version: z.literal(1), property: CanonicalPropertyV1Schema }).strict();
export const CreateRequestSchema = CommonRequestSchema.extend({ job_id: z.string().uuid() }).strict();
