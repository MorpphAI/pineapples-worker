import { CanonicalPropertyV1 } from "./canonicalPropertyV1";
import { AVANTIO_ACCOMMODATION_CONTRACT_VERSION, providerContractAvailable } from "./providerContract";

export type BlockingError = { code: string; message: string; canonical_path: string | null; provider_path: string | null; section: string };
export function readiness(property: CanonicalPropertyV1): { ready: boolean; blocking_errors: BlockingError[]; warnings: string[] } {
  const errors: BlockingError[] = [];
  const required: Array<[keyof CanonicalPropertyV1["capacity"], string, string]> = [["max_adults", "Informe a capacidade máxima de adultos.", "capacity"], ["bathroom_count", "Informe a quantidade de banheiros.", "capacity"]];
  for (const [field, message, section] of required) if (property.capacity[field] == null) errors.push({ code: `${field}_required`, message, canonical_path: `capacity.${field}`, provider_path: field === "bathroom_count" ? "distribution.bathrooms" : null, section });
  if (!providerContractAvailable) errors.push({ code: "contract_unavailable", message: "O contrato de criação da Avantio ainda não foi verificado.", canonical_path: null, provider_path: null, section: "provider_contract" });
  return { ready: errors.length === 0, blocking_errors: errors, warnings: [] };
}
export { AVANTIO_ACCOMMODATION_CONTRACT_VERSION };
