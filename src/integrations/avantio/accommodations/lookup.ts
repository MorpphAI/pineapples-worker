import { exactReferenceLookupAvailable } from "./providerContract";

export type AccommodationCandidate = { external_id: string; external_reference: string | null; name: string | null; remote_status: string | null };
export function assertExactReferenceLookupAvailable(): void { if (!exactReferenceLookupAvailable) throw new Error("external_reference_lookup_unavailable"); }
