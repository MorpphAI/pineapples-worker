import { z } from "zod";

export const OperationSchema = z.enum(["readiness", "create", "reconcile"]);
export const ReadinessIssueSchema = z.object({ code: z.string(), message: z.string(), canonical_path: z.string().nullable(), provider_path: z.string().nullable(), section: z.string().nullable() }).strict();
export const CandidateSchema = z.object({ external_id: z.string().min(1), external_reference: z.string().nullable(), label: z.string().nullable(), remote_status: z.string().nullable() }).strict();

export const ReadinessResponseSchema = z.object({
  success: z.literal(true), operation: z.literal("readiness"), outcome: z.enum(["ready", "not_ready", "temporarily_unavailable"]),
  contract_version: z.literal("worker-accommodation-v1"), canonical_schema_version: z.literal(1), property_version: z.number().int().nonnegative(),
  payload_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), provider_request_id: z.string().nullable(), errors: z.array(ReadinessIssueSchema), warnings: z.array(ReadinessIssueSchema),
}).strict();

export const CreateOutcomeSchema = z.enum(["created", "found_existing", "not_ready", "provider_rejected", "conflict", "uncertain", "temporarily_unavailable", "create_disabled"]);
export const ReconcileOutcomeSchema = z.enum(["not_found", "found_one", "found_multiple", "provider_rejected", "temporarily_unavailable"]);

const normalizedFields = {
  external_id: z.string().nullable(), external_reference: z.string().nullable(), remote_status: z.string().nullable(), property_version: z.number().int().nonnegative(),
  payload_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), contract_version: z.literal("worker-accommodation-v1"), provider_request_id: z.string().nullable(),
  errors: z.array(ReadinessIssueSchema), warnings: z.array(ReadinessIssueSchema), candidates: z.array(CandidateSchema),
};
const createBase = z.object({ operation: z.literal("create"), ...normalizedFields }).strict();
export const CreateResponseSchema = z.discriminatedUnion("outcome", [
  createBase.extend({ success: z.literal(true), outcome: z.literal("created"), external_id: z.string().min(1) }),
  createBase.extend({ success: z.literal(true), outcome: z.literal("found_existing"), external_id: z.string().min(1) }),
  ...(["not_ready", "provider_rejected", "conflict", "uncertain", "temporarily_unavailable", "create_disabled"] as const).map((outcome) => createBase.extend({ success: z.literal(false), outcome: z.literal(outcome), external_id: z.null() })),
]);
const reconcileBase = z.object({ operation: z.literal("reconcile"), ...normalizedFields }).strict();
export const ReconcileResponseSchema = z.discriminatedUnion("outcome", [
  reconcileBase.extend({ success: z.literal(true), outcome: z.literal("not_found"), external_id: z.null() }),
  reconcileBase.extend({ success: z.literal(true), outcome: z.literal("found_one"), external_id: z.string().min(1) }),
  reconcileBase.extend({ success: z.literal(false), outcome: z.literal("found_multiple"), external_id: z.null() }),
  reconcileBase.extend({ success: z.literal(false), outcome: z.literal("provider_rejected"), external_id: z.null() }),
  reconcileBase.extend({ success: z.literal(false), outcome: z.literal("temporarily_unavailable"), external_id: z.null() }),
]);
export const ValidationFailureSchema = z.object({ success: z.literal(false), operation: OperationSchema, outcome: z.literal("not_ready"), errors: z.array(ReadinessIssueSchema).min(1), warnings: z.array(ReadinessIssueSchema) }).strict();

export type CreateOutcome = z.infer<typeof CreateOutcomeSchema>;
export type ReconcileOutcome = z.infer<typeof ReconcileOutcomeSchema>;

export function emptyNormalized(operation: "create" | "reconcile", outcome: CreateOutcome | ReconcileOutcome, propertyVersion: number, externalReference: string | null) {
  return {
    success: false, operation, outcome, external_id: null as string | null, external_reference: externalReference, remote_status: null as string | null,
    property_version: propertyVersion, payload_hash: null as string | null, contract_version: "worker-accommodation-v1" as const, provider_request_id: null as string | null,
    errors: [] as z.infer<typeof ReadinessIssueSchema>[], warnings: [] as z.infer<typeof ReadinessIssueSchema>[], candidates: [] as z.infer<typeof CandidateSchema>[],
  };
}
