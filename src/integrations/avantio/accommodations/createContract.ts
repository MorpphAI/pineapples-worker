import { z } from "zod";

export const AvantioPropertyTypeSchema = z.enum(["APARTMENT", "HOUSE", "STUDIO", "RENT_BY_ROOM"]);
export const AvantioBedTypeSchema = z.enum(["INDIVIDUAL", "DOUBLE", "QUEENSIZE", "KINGSIZE", "BUNK"]);
export const AvantioCooktopSchema = z.enum(["GAS", "ELECTRIC", "INDUCTION"]);
export const AvantioKitchenTypeSchema = z.enum(["AMERICAN", "INDEPENDENT"]);
export const AvantioKitchenApplianceSchema = z.enum([
  "FRIDGE",
  "FREEZER",
  "OVEN",
  "MICROWAVE",
  "FRYER",
  "TOASTER",
  "COFFEE_MACHINE",
  "TABLEWARE",
  "KITCHEN_UTENSILS",
  "DISHWASHER",
  "WASHING_MACHINE",
  "DRYER",
  "JUICE_SQUEEZER",
  "ELECTRIC_KETTLE",
]);
export const AvantioSurroundingsDescriptionSchema = z.enum([
  "OF_RECENT_CONSTRUCTION",
  "MODERN",
  "TOTALLY_EQUIPPED",
  "NEW_FURNITURE",
  "KITCHEN_TOTALLY_EQUIPPED",
  "EXTERIOR",
  "VERY_BRIGHT",
  "LARGE",
  "AMPLE",
  "FURNISHED_WITH_TASTE",
  "COZY",
  "SWEET",
  "BEAUTIFUL",
  "COMFORTABLE",
]);

const CoordinatesSchema = z.object({ lat: z.string().min(1), lon: z.string().min(1) }).strict();
const BedSchema = z.object({ type: AvantioBedTypeSchema, amount: z.number().int().positive() }).strict();
const BedroomSchema = z.object({ beds: z.array(BedSchema).min(1), type: z.literal("BEDROOM"), floor: z.number().int() }).strict();
const BathroomSchema = z.object({
  count: z.number().int().positive(),
  type: z.literal("WITH_SHOWER"),
  heater: z.enum(["BOILER", "ELECTRIC", "SOLAR"]).optional(),
}).strict();
const KitchenSchema = z.object({
  count: z.number().int().positive(),
  type: AvantioKitchenTypeSchema,
  cooktop: AvantioCooktopSchema.optional(),
  appliances: z.array(AvantioKitchenApplianceSchema).optional(),
}).strict();
const ServiceTermsSchema = z.object({
  additionalPrice: z.object({ amount: z.literal(0), currency: z.literal("BRL"), paymentType: z.literal("INCLUDED") }).strict(),
  application: z.object({
    rule: z.literal("MANDATORY_ALWAYS"),
    comparison: z.object({ type: z.literal("GREATER"), value: z.literal(0) }).strict(),
    quantity: z.literal(0),
  }).strict(),
}).strict();
const InternetServiceSchema = z.object({
  type: z.literal("INTERNET_ACCESS"), accessType: z.literal("WIFI"), available: z.literal(true),
  displayMode: z.literal("VISIBLE_INCLUDED"), terms: ServiceTermsSchema,
}).strict();
const AirConditionedServiceSchema = z.object({
  type: z.literal("AIR_CONDITIONED"),
  airConditionedType: z.enum([
    "YES_ALL_THE_ACCOMMODATION",
    "YES_ONLY_IN_BEDROOMS",
    "YES_ONLY_LOUNGE_ROOM",
    "YES_IN_THE_LIVING_ROOM_AND_IN_SOME_BEDROOMS",
  ]),
  available: z.literal(true), displayMode: z.literal("VISIBLE_INCLUDED"), terms: ServiceTermsSchema,
}).strict();
const PetsServiceSchema = z.object({
  type: z.literal("PETS_ALLOWED"), available: z.boolean(), displayMode: z.literal("VISIBLE_INCLUDED"),
  dangerousAllowed: z.boolean().optional(), maxWeight: z.number().positive().optional(), terms: ServiceTermsSchema,
}).strict();
const FinalCleanServiceSchema = z.object({
  type: z.literal("FINAL_CLEAN"), available: z.literal(true), displayMode: z.literal("VISIBLE_ITEMIZED"), terms: ServiceTermsSchema,
}).strict();
const FeaturesSchema = z.object({
  accessibility: z.object({ elevator: z.boolean() }).strict().optional(),
  iron: z.boolean().optional(),
  ironingBoard: z.boolean().optional(),
  hairDryer: z.boolean().optional(),
  hasFan: z.boolean().optional(),
  diningTable: z.boolean().optional(),
  blackout: z.boolean().optional(),
  curtains: z.boolean().optional(),
  hangers: z.boolean().optional(),
  electronicLock: z.boolean().optional(),
  bidet: z.boolean().optional(),
  mattressProtector: z.boolean().optional(),
  blanket: z.boolean().optional(),
  pillow: z.boolean().optional(),
  cutlery: z.boolean().optional(),
  dinnerware: z.boolean().optional(),
  tvConfiguration: z.object({ hasSmartTv: z.boolean().optional(), hasCableTv: z.boolean().optional() }).strict().optional(),
}).strict();

export const AvantioAccommodationCreateRequestSchema = z.object({
  name: z.string().trim().min(1),
  type: AvantioPropertyTypeSchema,
  status: z.literal("DISABLED"),
  purpose: z.literal("RENTAL"),
  pricingModel: z.literal("SEASONAL_RATES"),
  capacity: z.object({ min: z.literal(1), maxAdults: z.number().int().nonnegative(), maxChildren: z.number().int().nonnegative().optional() }).strict(),
  features: FeaturesSchema.optional(),
  location: z.object({
    addrType: z.literal("STREET"),
    door: z.string().optional(), floor: z.string().optional(), admin1: z.string().min(1), number: z.string().min(1), resort: z.string().optional(),
    address: z.string().min(1), cityName: z.string().min(1), postalCode: z.string().regex(/^\d{8}$/).optional(), countryCode: z.string().min(1), coordinates: CoordinatesSchema.optional(),
  }).strict(),
  registryData: z.object({ legalEntityId: z.null(), managedBy: z.literal("PRIVATE"), registerReference: z.string().trim().min(1) }).strict(),
  services: z.array(z.discriminatedUnion("type", [InternetServiceSchema, AirConditionedServiceSchema, PetsServiceSchema, FinalCleanServiceSchema])).min(1),
  distribution: z.object({ bedrooms: z.array(BedroomSchema).min(1), kitchens: KitchenSchema.optional(), bathrooms: z.array(BathroomSchema).length(1) }).strict(),
  externalReference: z.string().trim().min(1),
  surroundingsAndDistances: z.object({ descriptions: z.array(AvantioSurroundingsDescriptionSchema).min(1) }).strict(),
  area: z.object({ livingSpace: z.object({ amount: z.number().finite().nonnegative(), unit: z.literal("m2") }).strict() }).strict().optional(),
}).strict();

export const AvantioAccommodationCreateSuccessSchema = z.object({
  data: z.object({ id: z.union([z.string(), z.number()]), status: z.string().optional() }).passthrough(),
}).passthrough();

export type AvantioAccommodationCreateRequest = z.infer<typeof AvantioAccommodationCreateRequestSchema>;
