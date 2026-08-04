import { AvantioApiGateway, AvantioCreateResult } from "../../../apiGateways/avantio/getAppointments";
import { Env } from "../../../types/configTypes";
import { CanonicalPropertyV1 } from "./canonicalPropertyV1";
import { AccommodationCandidate } from "./lookup";
import { AvantioProviderError } from "./providerErrors";
import { CreateOutcome, emptyNormalized, ReconcileOutcome } from "./publicContract";
import { readiness } from "./readiness";

type Gateway = Pick<AvantioApiGateway, "findAccommodationsByExternalReference" | "createAccommodation">;
export type ServiceResponse = { status: 200 | 409 | 422 | 503; body: ReturnType<typeof emptyNormalized> };

function providerIssue(error: AvantioProviderError) {
  return { code: error.code, message: error.message, canonical_path: null, provider_path: null, section: "provider" };
}

function lookupFailure(operation: "create" | "reconcile", propertyVersion: number, reference: string, error: unknown): ServiceResponse {
  const kind = error instanceof AvantioProviderError ? error.kind : "temporarily_unavailable";
  const outcome: CreateOutcome | ReconcileOutcome = kind === "provider_rejected" || kind === "invalid_provider_response" ? "provider_rejected" : "temporarily_unavailable";
  const body = emptyNormalized(operation, outcome, propertyVersion, reference);
  body.provider_request_id = error instanceof AvantioProviderError ? error.providerRequestId : null;
  body.errors.push(error instanceof AvantioProviderError ? providerIssue(error) : { code: "provider_temporarily_unavailable", message: "A consulta à Avantio falhou temporariamente.", canonical_path: null, provider_path: null, section: "provider" });
  return { status: outcome === "provider_rejected" ? 422 : 503, body };
}

export class AvantioAccommodationService {
  private readonly gateway: Gateway;
  constructor(private readonly env: Env, gateway?: Gateway) { this.gateway = gateway ?? new AvantioApiGateway(env); }

  async create(property: CanonicalPropertyV1, propertyVersion: number): Promise<ServiceResponse> {
    const reference = property.identification.code;
    const ready = await readiness(property);
    if (!ready.ready || !ready.payload) {
      const body = emptyNormalized("create", "not_ready", propertyVersion, reference);
      body.errors = ready.errors; body.warnings = ready.warnings;
      return { status: 422, body };
    }

    let candidates: AccommodationCandidate[];
    try { candidates = await this.gateway.findAccommodationsByExternalReference(reference); }
    catch (error) { return lookupFailure("create", propertyVersion, reference, error); }

    if (candidates.length === 1) {
      const candidate = candidates[0];
      const body = emptyNormalized("create", "found_existing", propertyVersion, reference);
      body.success = true; body.external_id = candidate.external_id; body.remote_status = candidate.remote_status; body.payload_hash = ready.payload_hash; body.warnings = ready.warnings;
      return { status: 200, body };
    }
    if (candidates.length > 1) {
      const body = emptyNormalized("create", "conflict", propertyVersion, reference);
      body.payload_hash = ready.payload_hash; body.candidates = candidates; body.warnings = ready.warnings;
      body.errors.push({ code: "multiple_remote_matches", message: "Mais de uma acomodação foi encontrada.", canonical_path: "identification.code", provider_path: "externalReference", section: "identification" });
      return { status: 409, body };
    }
    if (String(this.env.AVANTIO_ACCOMMODATION_CREATE_ENABLED ?? "").trim().toLowerCase() !== "true") {
      const body = emptyNormalized("create", "create_disabled", propertyVersion, reference);
      body.payload_hash = ready.payload_hash; body.warnings = ready.warnings;
      body.errors.push({ code: "create_disabled", message: "A criação de acomodações está desativada.", canonical_path: null, provider_path: null, section: "configuration" });
      return { status: 503, body };
    }

    try {
      const created: AvantioCreateResult = await this.gateway.createAccommodation(ready.payload);
      const body = emptyNormalized("create", "created", propertyVersion, reference);
      body.success = true; body.external_id = created.externalId; body.remote_status = created.remoteStatus; body.provider_request_id = created.providerRequestId; body.payload_hash = ready.payload_hash; body.warnings = ready.warnings;
      return { status: 200, body };
    } catch (error) {
      if (!(error instanceof AvantioProviderError)) return lookupFailure("create", propertyVersion, reference, error);
      const outcome: CreateOutcome = error.kind === "uncertain" ? "uncertain" : error.kind === "temporarily_unavailable" ? "temporarily_unavailable" : "provider_rejected";
      const body = emptyNormalized("create", outcome, propertyVersion, reference);
      body.payload_hash = ready.payload_hash; body.provider_request_id = error.providerRequestId; body.warnings = ready.warnings; body.errors.push(providerIssue(error));
      return { status: outcome === "uncertain" ? 409 : outcome === "temporarily_unavailable" ? 503 : 422, body };
    }
  }

  async reconcile(property: CanonicalPropertyV1, propertyVersion: number): Promise<ServiceResponse> {
    const reference = property.identification.code;
    let candidates: AccommodationCandidate[];
    try { candidates = await this.gateway.findAccommodationsByExternalReference(reference); }
    catch (error) { return lookupFailure("reconcile", propertyVersion, reference, error); }
    const outcome: ReconcileOutcome = candidates.length === 0 ? "not_found" : candidates.length === 1 ? "found_one" : "found_multiple";
    const body = emptyNormalized("reconcile", outcome, propertyVersion, reference);
    body.success = candidates.length <= 1; body.candidates = candidates;
    if (candidates.length === 1) { body.external_id = candidates[0].external_id; body.remote_status = candidates[0].remote_status; }
    if (candidates.length > 1) body.errors.push({ code: "multiple_remote_matches", message: "Mais de uma acomodação foi encontrada.", canonical_path: "identification.code", provider_path: "externalReference", section: "identification" });
    return { status: candidates.length > 1 ? 409 : 200, body };
  }
}
