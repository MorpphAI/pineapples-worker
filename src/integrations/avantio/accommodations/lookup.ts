import { AvantioAccommodation } from "../../../types/avantioTypes";

export type AccommodationCandidate = { external_id: string; external_reference: string | null; label: string | null; remote_status: string | null };

export function authoritativeAccommodationId(value: Record<string, unknown>): string | null {
  for (const field of ["id", "accommodationId", "accommodation_id"] as const) {
    const candidate = value[field];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  }
  return null;
}

export function accommodationToCandidate(value: AvantioAccommodation | Record<string, unknown>): AccommodationCandidate | null {
  const externalId = authoritativeAccommodationId(value as Record<string, unknown>);
  if (!externalId) return null;
  return {
    external_id: externalId,
    external_reference: typeof value.externalReference === "string" ? value.externalReference : null,
    label: typeof value.name === "string" ? value.name : null,
    remote_status: typeof value.status === "string" ? value.status : null,
  };
}

export function exactExternalReferenceMatches(records: AvantioAccommodation[], reference: string): AccommodationCandidate[] {
  return records
    .filter((record) => typeof record.externalReference === "string" && record.externalReference === reference)
    .map(accommodationToCandidate)
    .filter((candidate): candidate is AccommodationCandidate => candidate !== null);
}

export function summarizeAccommodationReferencePresence(records: Array<Record<string, unknown>>): {
  total: number; with_externalReference: number; with_registry_registerReference: number;
} {
  return {
    total: records.length,
    with_externalReference: records.filter((record) => typeof record.externalReference === "string" && record.externalReference.length > 0).length,
    with_registry_registerReference: records.filter((record) => {
      const registry = record.registryData;
      return !!registry && typeof registry === "object" && typeof (registry as Record<string, unknown>).registerReference === "string";
    }).length,
  };
}
