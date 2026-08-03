import { OpenAPIRoute } from "chanfana";
import { Context } from "hono";
import { z } from "zod";
import { Env } from "../../../../types/configTypes";
import { CommonRequestSchema, containsProhibitedKey, CreateRequestSchema, payloadHash, readiness, AVANTIO_ACCOMMODATION_CONTRACT_VERSION, exactReferenceLookupAvailable } from "../../../../integrations/avantio/accommodations";

function invalid(c: Context<{ Bindings: Env }>, reason: string) { return c.json({ success: false, error: { stage: "validation", code: "invalid_request", message: reason } }, 422); }
async function read(c: Context<{ Bindings: Env }>, create = false) {
  let body: unknown;
  try { body = await c.req.json(); } catch { return { error: invalid(c, "JSON inválido.") }; }
  if (containsProhibitedKey(body)) return { error: invalid(c, "A solicitação contém um campo não permitido.") };
  const parsed = (create ? CreateRequestSchema : CommonRequestSchema).safeParse(body);
  if (!parsed.success) return { error: invalid(c, "A solicitação não atende ao contrato canônico.") };
  return { value: parsed.data };
}

export class AvantioAccommodationReadiness extends OpenAPIRoute {
  schema = { tags: ["Avantio"], summary: "Validate canonical property readiness", request: { body: { content: { "application/json": { schema: CommonRequestSchema } } } }, responses: { "200": { description: "Readiness result", content: { "application/json": { schema: z.object({ success: z.boolean() }) } } } } };
  async handle(c: Context<{ Bindings: Env }>) {
    const input = await read(c); if ("error" in input) return input.error;
    const result = readiness(input.value.property);
    return c.json({ success: true, operation: "readiness", ready: result.ready, contract_version: AVANTIO_ACCOMMODATION_CONTRACT_VERSION, canonical_schema_version: 1, property_version: input.value.property_version, payload_hash: null, blocking_errors: result.blocking_errors, warnings: result.warnings }, 200);
  }
}

export class AvantioAccommodationCreate extends OpenAPIRoute {
  schema = { tags: ["Avantio"], summary: "Safely create an Avantio accommodation", responses: { "200": { description: "Created or existing" } } };
  async handle(c: Context<{ Bindings: Env }>) {
    const input = await read(c, true); if ("error" in input) return input.error;
    if (String(c.env.AVANTIO_ACCOMMODATION_CREATE_ENABLED ?? "").trim().toLowerCase() !== "true") return c.json({ success: false, operation: "create", outcome: "not_ready", retryable: false, requires_reconciliation: false, blocking_errors: [], error: { stage: "configuration", code: "create_disabled", message: "A criação de acomodações está desativada." } }, 503);
    const result = readiness(input.value.property);
    if (!result.ready) return c.json({ success: false, operation: "create", outcome: "not_ready", retryable: false, requires_reconciliation: false, blocking_errors: result.blocking_errors, error: { stage: "readiness", code: result.blocking_errors[0]?.code ?? "not_ready", message: result.blocking_errors[0]?.message ?? "Imóvel não está pronto.", provider_status: null, provider_path: result.blocking_errors[0]?.provider_path ?? null, canonical_path: result.blocking_errors[0]?.canonical_path ?? null, provider_request_id: null } }, 422);
    return c.json({ success: false, operation: "create", outcome: "not_ready", retryable: false, requires_reconciliation: false, blocking_errors: [{ code: "external_reference_lookup_unavailable", message: "Não há campo de referência externa Avantio verificado.", canonical_path: "identification.code", provider_path: null, section: "lookup" }], error: { stage: "lookup", code: "external_reference_lookup_unavailable", message: "Não há campo de referência externa Avantio verificado." } }, 503);
  }
}

export class AvantioAccommodationReconcile extends OpenAPIRoute {
  schema = { tags: ["Avantio"], summary: "Read-only exact-reference reconciliation", responses: { "200": { description: "Reconciliation result" } } };
  async handle(c: Context<{ Bindings: Env }>) {
    const input = await read(c); if ("error" in input) return input.error;
    if (!exactReferenceLookupAvailable) return c.json({ success: false, operation: "reconcile", outcome: "lookup_unavailable", retryable: false, requires_reconciliation: false, error: { stage: "lookup", code: "external_reference_lookup_unavailable", message: "Não há campo de referência externa Avantio verificado." } }, 503);
    return c.json({ success: true, operation: "reconcile", outcome: "not_found", external_reference: input.value.property.identification.code, candidates: [] }, 200);
  }
}
