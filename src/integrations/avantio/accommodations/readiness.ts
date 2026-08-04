import { CanonicalPropertyV1 } from "./canonicalPropertyV1";
import { mapCanonicalToAuthoritativeReadShape } from "./mappings";
import { AVANTIO_ACCOMMODATION_CONTRACT_VERSION, exactReferenceLookupAvailable, providerCreateContractAvailable } from "./providerContract";

export type ReadinessIssue = { code: string; message: string; canonical_path: string | null; provider_path: string | null; section: string | null };
export type ReadinessResult = { ready: boolean; mapped: ReturnType<typeof mapCanonicalToAuthoritativeReadShape>; errors: ReadinessIssue[]; warnings: ReadinessIssue[] };

export function readiness(property: CanonicalPropertyV1): ReadinessResult {
  const errors: ReadinessIssue[] = [];
  const requiredReadFields: Array<[unknown, string, string, string, string]> = [
    [property.identification.title, "title_required", "Informe o título da acomodação.", "identification.title", "name"],
    [property.address.country, "country_required", "Informe o país.", "address.country", "location.countryCode"],
    [property.address.city, "city_required", "Informe a cidade.", "address.city", "location.cityName"],
    [property.address.postal_code, "postal_code_required", "Informe o código postal.", "address.postal_code", "location.postalCode"],
    [property.address.street, "street_required", "Informe a rua.", "address.street", "location.address"],
    [property.address.number, "number_required", "Informe o número.", "address.number", "location.number"],
  ];
  for (const [value, code, message, canonicalPath, providerPath] of requiredReadFields) {
    if (value === null || value === "") errors.push({ code, message, canonical_path: canonicalPath, provider_path: providerPath, section: canonicalPath.split(".")[0] });
  }
  if (!providerCreateContractAvailable) errors.push({ code: "provider_create_model_unavailable", message: "O Worker não possui um modelo autoritativo de criação de acomodação.", canonical_path: null, provider_path: null, section: "provider_contract" });
  if (!exactReferenceLookupAvailable) errors.push({ code: "external_reference_field_unavailable", message: "O modelo autoritativo de leitura não possui um campo de referência externa verificado.", canonical_path: "identification.code", provider_path: null, section: "identification" });
  return { ready: errors.length === 0, mapped: mapCanonicalToAuthoritativeReadShape(property), errors, warnings: [] };
}

export { AVANTIO_ACCOMMODATION_CONTRACT_VERSION };
