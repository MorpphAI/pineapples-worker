import { OpenAPIRoute } from "chanfana";
import { Context } from "hono";
import { z } from "zod";
import { Env } from "../../../../types/configTypes";
import {
  AVANTIO_ACCOMMODATION_CONTRACT_VERSION,
  CommonRequestSchema,
  CreateRequestSchema,
  emptyNormalized,
  findSensitiveKeyPaths,
  readiness,
} from "../../../../integrations/avantio/accommodations";

type Phase3Context = Context<{ Bindings: Env }>;

function validationFailure(c: Phase3Context, code: string, message: string, canonicalPath: string | null) {
  return c.json({
    success: false,
    operation: "validation",
    outcome: "not_ready",
    errors: [{ code, message, canonical_path: canonicalPath, provider_path: null, section: canonicalPath?.split(".")[0] ?? null }],
    warnings: [],
  }, 422);
}

async function parseRequest(c: Phase3Context, create: boolean) {
  let body: unknown;
  try { body = await c.req.json(); } catch { return { error: validationFailure(c, "invalid_json", "O corpo deve conter JSON válido.", null) }; }
  const sensitivePaths = findSensitiveKeyPaths(body);
  if (sensitivePaths.length > 0) return { error: validationFailure(c, "sensitive_key_rejected", "A solicitação contém um campo sensível não permitido.", sensitivePaths[0]) };
  const parsed = (create ? CreateRequestSchema : CommonRequestSchema).safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: validationFailure(c, "invalid_canonical_request", "A solicitação não atende ao contrato canônico.", issue?.path.join(".") || null) };
  }
  return { value: parsed.data };
}

const genericResponseSchema = z.object({ success: z.boolean(), operation: z.string(), outcome: z.string() }).passthrough();

export class AvantioAccommodationReadiness extends OpenAPIRoute {
  schema = {
    tags: ["Avantio"], summary: "Validate PineOS canonical property readiness without provider writes",
    request: { body: { content: { "application/json": { schema: CommonRequestSchema } } } },
    responses: { "200": { description: "Deterministic readiness result", content: { "application/json": { schema: genericResponseSchema } } }, "422": { description: "Invalid public request", content: { "application/json": { schema: genericResponseSchema } } } },
  };

  async handle(c: Phase3Context) {
    const input = await parseRequest(c, false); if ("error" in input) return input.error;
    const result = readiness(input.value.property);
    return c.json({
      success: true,
      operation: "readiness",
      outcome: result.ready ? "ready" : "not_ready",
      contract_version: AVANTIO_ACCOMMODATION_CONTRACT_VERSION,
      canonical_schema_version: 1,
      property_version: input.value.property_version,
      payload_hash: null,
      provider_request_id: null,
      errors: result.errors,
      warnings: result.warnings,
    }, 200);
  }
}

export class AvantioAccommodationCreate extends OpenAPIRoute {
  schema = {
    tags: ["Avantio"], summary: "Create an Avantio accommodation at most once when the verified contract is available",
    request: { body: { content: { "application/json": { schema: CreateRequestSchema } } } },
    responses: { "422": { description: "Not ready", content: { "application/json": { schema: genericResponseSchema } } }, "503": { description: "Creation disabled or unavailable", content: { "application/json": { schema: genericResponseSchema } } } },
  };

  async handle(c: Phase3Context) {
    const input = await parseRequest(c, true); if ("error" in input) return input.error;
    const base = emptyNormalized("create", "create_disabled", input.value.property_version, input.value.property.identification.code);
    if (String(c.env.AVANTIO_ACCOMMODATION_CREATE_ENABLED ?? "").trim().toLowerCase() !== "true") {
      base.errors.push({ code: "create_disabled", message: "A criação de acomodações está desativada.", canonical_path: null, provider_path: null, section: "configuration" });
      return c.json(base, 503);
    }
    const result = readiness(input.value.property);
    base.outcome = "not_ready";
    base.errors = result.errors;
    base.warnings = result.warnings;
    return c.json(base, 422);
  }
}

export class AvantioAccommodationReconcile extends OpenAPIRoute {
  schema = {
    tags: ["Avantio"], summary: "Read-only exact external-reference reconciliation",
    request: { body: { content: { "application/json": { schema: CommonRequestSchema } } } },
    responses: { "503": { description: "Exact lookup unavailable", content: { "application/json": { schema: genericResponseSchema } } } },
  };

  async handle(c: Phase3Context) {
    const input = await parseRequest(c, false); if ("error" in input) return input.error;
    const body = emptyNormalized("reconcile", "temporarily_unavailable", input.value.property_version, input.value.property.identification.code);
    body.errors.push({ code: "external_reference_field_unavailable", message: "O modelo autoritativo de leitura não possui um campo de referência externa verificado.", canonical_path: "identification.code", provider_path: null, section: "identification" });
    return c.json(body, 503);
  }
}
