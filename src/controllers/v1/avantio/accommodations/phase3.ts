import { OpenAPIRoute } from "chanfana";
import { Context } from "hono";
import { Env } from "../../../../types/configTypes";
import {
  AVANTIO_ACCOMMODATION_CONTRACT_VERSION,
  AvantioAccommodationService,
  CommonRequestSchema,
  CreateRequest,
  CreateRequestSchema,
  CreateResponseSchema,
  findSensitiveKeyPaths,
  ReadinessResponseSchema,
  ReconcileResponseSchema,
  readiness,
  ValidationFailureSchema,
} from "../../../../integrations/avantio/accommodations";

type Phase3Context = Context<{ Bindings: Env }>;
type Operation = "readiness" | "create" | "reconcile";

function validationFailure(c: Phase3Context, operation: Operation, code: string, message: string, canonicalPath: string | null) {
  return c.json({
    success: false, operation, outcome: "not_ready" as const,
    errors: [{ code, message, canonical_path: canonicalPath, provider_path: null, section: canonicalPath?.split(".")[0] ?? null }], warnings: [],
  }, 422);
}

async function parseRequest(c: Phase3Context, operation: Operation) {
  let body: unknown;
  try { body = await c.req.json(); } catch { return { error: validationFailure(c, operation, "invalid_json", "O corpo deve conter JSON válido.", null) }; }
  const sensitivePaths = findSensitiveKeyPaths(body);
  if (sensitivePaths.length > 0) return { error: validationFailure(c, operation, "sensitive_key_rejected", "A solicitação contém um campo sensível não permitido.", sensitivePaths[0]) };
  const parsed = (operation === "create" ? CreateRequestSchema : CommonRequestSchema).safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: validationFailure(c, operation, "invalid_canonical_request", "A solicitação não atende ao contrato canônico.", issue?.path.join(".") || null) };
  }
  return { value: parsed.data };
}

const validationResponse = { "422": { description: "Invalid public request", content: { "application/json": { schema: ValidationFailureSchema } } } };

export class AvantioAccommodationReadiness extends OpenAPIRoute {
  schema = {
    tags: ["Avantio"], summary: "Validate PineOS canonical property readiness without provider writes",
    request: { body: { content: { "application/json": { schema: CommonRequestSchema } } } },
    responses: { "200": { description: "Deterministic readiness result", content: { "application/json": { schema: ReadinessResponseSchema } } }, ...validationResponse },
  };
  async handle(c: Phase3Context) {
    const input = await parseRequest(c, "readiness"); if ("error" in input) return input.error;
    const result = await readiness(input.value.property);
    return c.json({
      success: true as const, operation: "readiness" as const, outcome: result.ready ? "ready" as const : "not_ready" as const,
      contract_version: AVANTIO_ACCOMMODATION_CONTRACT_VERSION, canonical_schema_version: 1 as const, property_version: input.value.property_version,
      payload_hash: result.payload_hash, provider_request_id: null, errors: result.errors, warnings: result.warnings,
    }, 200);
  }
}

export class AvantioAccommodationCreate extends OpenAPIRoute {
  schema = {
    tags: ["Avantio"], summary: "Create an Avantio accommodation at most once after exact-reference lookup",
    request: { body: { content: { "application/json": { schema: CreateRequestSchema } } } },
    responses: {
      "200": { description: "Created or found existing", content: { "application/json": { schema: CreateResponseSchema } } },
      "409": { description: "Conflict or uncertain outcome", content: { "application/json": { schema: CreateResponseSchema } } },
      "422": { description: "Not ready or provider rejected", content: { "application/json": { schema: CreateResponseSchema.or(ValidationFailureSchema) } } },
      "503": { description: "Disabled or temporarily unavailable", content: { "application/json": { schema: CreateResponseSchema } } },
    },
  };
  async handle(c: Phase3Context) {
    const input = await parseRequest(c, "create"); if ("error" in input) return input.error;
    const value = input.value as CreateRequest;
    const result = await new AvantioAccommodationService(c.env).create(value.property, value.property_version, {
      requestId: value.request_id,
      jobId: value.job_id,
      propertyId: value.property_id,
    });
    return c.json(result.body, result.status);
  }
}

export class AvantioAccommodationReconcile extends OpenAPIRoute {
  schema = {
    tags: ["Avantio"], summary: "Read-only exact external-reference reconciliation",
    request: { body: { content: { "application/json": { schema: CommonRequestSchema } } } },
    responses: {
      "200": { description: "Zero or one exact match", content: { "application/json": { schema: ReconcileResponseSchema } } },
      "409": { description: "Multiple exact matches", content: { "application/json": { schema: ReconcileResponseSchema } } },
      "422": { description: "Invalid request or provider rejection", content: { "application/json": { schema: ReconcileResponseSchema.or(ValidationFailureSchema) } } },
      "503": { description: "Provider temporarily unavailable", content: { "application/json": { schema: ReconcileResponseSchema } } },
    },
  };
  async handle(c: Phase3Context) {
    const input = await parseRequest(c, "reconcile"); if ("error" in input) return input.error;
    const result = await new AvantioAccommodationService(c.env).reconcile(input.value.property, input.value.property_version);
    return c.json(result.body, result.status);
  }
}
