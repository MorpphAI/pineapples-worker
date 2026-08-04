import { z } from "zod";

export const ReadinessIssueSchema = z.object({
  code: z.string(), message: z.string(), canonical_path: z.string().nullable(), provider_path: z.string().nullable(), section: z.string().nullable(),
});
export const CandidateSchema = z.object({
  external_id: z.string(), external_reference: z.string().nullable(), label: z.string().nullable(), remote_status: z.string().nullable(),
});

export function emptyNormalized(operation: "create" | "reconcile", outcome: string, propertyVersion: number, externalReference: string | null) {
  return {
    success: false,
    operation,
    outcome,
    external_id: null,
    external_reference: externalReference,
    remote_status: null,
    property_version: propertyVersion,
    payload_hash: null,
    contract_version: "worker-accommodation-v1",
    provider_request_id: null,
    errors: [] as Array<Record<string, unknown>>,
    warnings: [] as Array<Record<string, unknown>>,
    candidates: [] as Array<Record<string, unknown>>,
  };
}
