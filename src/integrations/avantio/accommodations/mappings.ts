import { CanonicalPropertyV1 } from "./canonicalPropertyV1";
import { providerContractAvailable } from "./providerContract";

/** Deliberately refuses to manufacture an Avantio payload until its contract is verified. */
export function mapCanonicalPropertyToAvantio(_property: CanonicalPropertyV1): never {
  if (!providerContractAvailable) throw new Error("contract_unavailable");
  throw new Error("unreachable");
}
