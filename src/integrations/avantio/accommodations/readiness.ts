import { CanonicalPropertyV1 } from "./canonicalPropertyV1";
import { mapCanonicalToAvantioCreate } from "./createMapper";
import { payloadHash } from "./payloadHash";
import { AVANTIO_ACCOMMODATION_CONTRACT_VERSION } from "./providerContract";

export type ReadinessIssue = { code: string; message: string; canonical_path: string | null; provider_path: string | null; section: string | null };
export type ReadinessResult = {
  ready: boolean;
  payload_hash: string | null;
  payload: ReturnType<typeof mapCanonicalToAvantioCreate>["payload"];
  errors: ReadinessIssue[];
  warnings: ReadinessIssue[];
};

export async function readiness(property: CanonicalPropertyV1): Promise<ReadinessResult> {
  const mapped = mapCanonicalToAvantioCreate(property);
  const hash = mapped.payload ? await payloadHash(mapped.payload) : null;
  return { ready: mapped.payload !== null && mapped.errors.length === 0, payload_hash: hash, payload: mapped.payload, errors: mapped.errors, warnings: mapped.warnings };
}

export { AVANTIO_ACCOMMODATION_CONTRACT_VERSION };
