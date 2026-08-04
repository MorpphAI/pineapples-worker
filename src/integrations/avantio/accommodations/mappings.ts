import { AvantioAccommodation } from "../../../types/avantioTypes";
import { CanonicalPropertyV1 } from "./canonicalPropertyV1";

/**
 * Maps only fields present in the authoritative accommodation read model.
 * This projection is for deterministic readiness diagnostics and MUST NOT be sent as a create request.
 */
export function mapCanonicalToAuthoritativeReadShape(property: CanonicalPropertyV1): Partial<Omit<AvantioAccommodation, "id">> {
  const location: Partial<AvantioAccommodation["location"]> = {};
  if (property.address.country !== null) location.countryCode = property.address.country;
  if (property.address.city !== null) location.cityName = property.address.city;
  if (property.address.postal_code !== null) location.postalCode = property.address.postal_code;
  if (property.address.street !== null) location.address = property.address.street;
  if (property.address.number !== null) location.number = property.address.number;
  if (property.address.unit !== null) location.door = property.address.unit;
  if (property.address.coordinates) location.coordinates = { lat: String(property.address.coordinates.latitude), lon: String(property.address.coordinates.longitude) };

  return {
    ...(property.identification.title !== null ? { name: property.identification.title } : {}),
    location: location as AvantioAccommodation["location"],
  };
}
