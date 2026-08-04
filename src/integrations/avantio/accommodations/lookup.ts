export type AccommodationCandidate = {
  external_id: string;
  external_reference: string | null;
  label: string | null;
  remote_status: string | null;
};

export class ExternalReferenceLookupUnavailableError extends Error {
  constructor() {
    super("The authoritative Avantio accommodation model has no verified external-reference field.");
    this.name = "ExternalReferenceLookupUnavailableError";
  }
}

export function assertExactReferenceLookupAvailable(): never {
  throw new ExternalReferenceLookupUnavailableError();
}
