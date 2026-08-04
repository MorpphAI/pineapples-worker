import { z } from "zod";

export const AvantioPropertyTypeSchema = z.enum(["APARTMENT", "HOUSE", "STUDIO", "RENT_BY_ROOM"]);
export const AvantioBedTypeSchema = z.enum(["INDIVIDUAL", "DOUBLE", "QUEENSIZE", "KINGSIZE", "BUNK"]);
export const AvantioCooktopSchema = z.enum(["GAS", "ELECTRIC", "INDUCTION"]);

const CoordinatesSchema = z.object({ lat: z.string().min(1), lon: z.string().min(1) }).strict();
const BedSchema = z.object({ type: AvantioBedTypeSchema, amount: z.number().int().positive() }).strict();
const BedroomSchema = z.object({ beds: z.array(BedSchema).min(1), type: z.literal("BEDROOM"), floor: z.number().int() }).strict();
const KitchenSchema = z.object({
  count: z.number().int().positive(),
  cooktop: AvantioCooktopSchema.optional(),
  appliances: z.array(z.string()).optional(),
}).strict();

export const AvantioAccommodationCreateRequestSchema = z.object({
  name: z.string().trim().min(1),
  type: AvantioPropertyTypeSchema,
  status: z.literal("ENABLED"),
  purpose: z.literal("RENTAL"),
  capacity: z.object({ min: z.literal(1), maxAdults: z.number().int().nonnegative(), maxChildren: z.number().int().nonnegative().optional() }).strict(),
  features: z.object({ accessibility: z.object({ elevator: z.boolean() }).strict() }).strict().optional(),
  location: z.object({
    door: z.string().optional(), floor: z.string().optional(), admin1: z.string().min(1), number: z.string().min(1), resort: z.string().optional(),
    address: z.string().min(1), cityName: z.string().min(1), postalCode: z.string().nullable().optional(), countryCode: z.string().min(1), coordinates: CoordinatesSchema.optional(),
  }).strict(),
  services: z.array(z.object({ type: z.literal("INTERNET_ACCESS") }).strict()).optional(),
  distribution: z.object({ bedrooms: z.array(BedroomSchema).min(1), kitchens: KitchenSchema.optional(), bathrooms: z.array(z.object({}).strict()) }).strict(),
  externalReference: z.string().trim().min(1),
  surroundingsAndDistances: z.object({ descriptions: z.array(z.string()) }).strict(),
  area: z.object({ livingSpace: z.object({ amount: z.number().finite().nonnegative(), unit: z.literal("m2") }).strict() }).strict().optional(),
}).strict();

export const AvantioAccommodationCreateSuccessSchema = z.object({
  data: z.object({ id: z.union([z.string(), z.number()]), status: z.string().optional() }).passthrough(),
}).passthrough();

export type AvantioAccommodationCreateRequest = z.infer<typeof AvantioAccommodationCreateRequestSchema>;
