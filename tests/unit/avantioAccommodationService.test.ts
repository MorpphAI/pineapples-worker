import { describe, expect, it, vi } from "vitest";
import { AvantioAccommodationService, AvantioProviderError, CanonicalPropertyV1Schema, CreateResponseSchema, ReconcileResponseSchema } from "../../src/integrations/avantio/accommodations";
import { productionCanonicalProperty } from "../fixtures/avantioAccommodationCreate";

const property = CanonicalPropertyV1Schema.parse(productionCanonicalProperty);
const enabledEnv = { AVANTIO_API_KEY: "", AVANTIO_BASE_URL: "", AVANTIO_ACCOMMODATION_CREATE_ENABLED: "true", API_KEY: "", DB: {} as D1Database };
const disabledEnv = { ...enabledEnv, AVANTIO_ACCOMMODATION_CREATE_ENABLED: "false" };
const candidate = { external_id: "existing", external_reference: "NSC314", label: "NSC314", remote_status: "ENABLED" };
function gateway(matches: any[] = [], createResult: any = { externalId: "created", remoteStatus: "ENABLED", providerRequestId: "request-1" }) {
  return {
    findAccommodationsByExternalReference: vi.fn().mockResolvedValue(matches),
    createAccommodation: vi.fn().mockResolvedValue(createResult),
    upsertCreatedAccommodationInActiveIndex: vi.fn().mockResolvedValue(undefined),
  };
}

describe("AvantioAccommodationService", () => {
  it("returns found_existing without POST", async () => {
    const fake = gateway([candidate]); const result = await new AvantioAccommodationService(disabledEnv, fake as any).create(property, 1);
    expect(result).toMatchObject({ status: 200, body: { success: true, outcome: "found_existing", external_id: "existing" } }); expect(fake.createAccommodation).not.toHaveBeenCalled();
  });

  it("returns conflict for multiple exact matches without POST", async () => {
    const fake = gateway([candidate, { ...candidate, external_id: "two" }]); const result = await new AvantioAccommodationService(enabledEnv, fake as any).create(property, 1);
    expect(result).toMatchObject({ status: 409, body: { outcome: "conflict" } }); expect(result.body.candidates).toHaveLength(2); expect(fake.createAccommodation).not.toHaveBeenCalled();
  });

  it("returns create_disabled after zero matches without POST", async () => {
    const fake = gateway([]); const result = await new AvantioAccommodationService(disabledEnv, fake as any).create(property, 1);
    expect(result).toMatchObject({ status: 503, body: { outcome: "create_disabled" } }); expect(fake.createAccommodation).not.toHaveBeenCalled();
  });

  it("creates exactly once and requires the gateway external ID", async () => {
    const fake = gateway([]); const result = await new AvantioAccommodationService(enabledEnv, fake as any).create(property, 1);
    expect(result).toMatchObject({ status: 200, body: { success: true, outcome: "created", external_id: "created", provider_request_id: "request-1" } }); expect(fake.createAccommodation).toHaveBeenCalledTimes(1);
    expect(fake.upsertCreatedAccommodationInActiveIndex).toHaveBeenCalledWith("created", "NSC314", "ENABLED");
    expect(CreateResponseSchema.safeParse(result.body).success).toBe(true);
  });

  it("preserves a successful create when the active-index upsert fails", async () => {
    const fake = gateway([]);
    fake.upsertCreatedAccommodationInActiveIndex.mockRejectedValue(new Error("D1 unavailable"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await new AvantioAccommodationService(enabledEnv, fake as any).create(property, 1);
    expect(result).toMatchObject({ status: 200, body: { outcome: "created", external_id: "created" } });
    expect(fake.createAccommodation).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith("[AvantioAccommodationService] accommodation_index_update_failed");
  });

  it.each([
    [new AvantioProviderError("provider_rejected", "provider_http_422", "rejected", "body_received", 422), "provider_rejected", 422],
    [new AvantioProviderError("temporarily_unavailable", "provider_http_500", "temporary", "body_received", 500), "temporarily_unavailable", 503],
    [new AvantioProviderError("uncertain", "provider_network_outcome_unknown", "unknown", "fetch_invoked"), "uncertain", 409],
    [new AvantioProviderError("invalid_provider_response", "missing_external_id", "missing", "body_received", 200), "uncertain", 409],
  ] as const)("normalizes create provider errors as %s", async (error, outcome, status) => {
    const fake = gateway([]); fake.createAccommodation.mockRejectedValue(error);
    const result = await new AvantioAccommodationService(enabledEnv, fake as any).create(property, 1);
    expect(result).toMatchObject({ status, body: { outcome } }); expect(fake.createAccommodation).toHaveBeenCalledTimes(1);
  });

  it("returns the generic HTTP 400 issue followed by sanitized provider details", async () => {
    const fake = gateway([]);
    fake.createAccommodation.mockRejectedValue(new AvantioProviderError(
      "provider_rejected",
      "provider_http_400",
      "A Avantio rejeitou ou não conseguiu processar a solicitação.",
      "body_received",
      400,
      null,
      [{ code: "provider_invalid_field", message: "Invalid address", canonical_path: null, provider_path: "location.address", section: "provider" }],
    ));

    const result = await new AvantioAccommodationService(enabledEnv, fake as any).create(property, 7, {
      requestId: "11111111-1111-4111-8111-111111111111",
      jobId: "33333333-3333-4333-8333-333333333333",
      propertyId: "22222222-2222-4222-8222-222222222222",
    });

    expect(result).toMatchObject({
      status: 422,
      body: {
        outcome: "provider_rejected",
        property_version: 7,
        provider_request_id: null,
        errors: [
          { code: "provider_http_400", provider_path: null },
          { code: "provider_invalid_field", message: "Invalid address", provider_path: "location.address", canonical_path: null },
        ],
      },
    });
    expect(CreateResponseSchema.safeParse(result.body).success).toBe(true);
    expect(fake.createAccommodation).toHaveBeenCalledWith(expect.anything(), {
      requestId: "11111111-1111-4111-8111-111111111111",
      jobId: "33333333-3333-4333-8333-333333333333",
      propertyId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("returns public uncertain with the provider request ID after an unusable 2xx success", async () => {
    const fake = gateway([]);
    fake.createAccommodation.mockRejectedValue(new AvantioProviderError("uncertain", "missing_external_id", "missing", "body_received", 201, "request-uncertain"));
    const result = await new AvantioAccommodationService(enabledEnv, fake as any).create(property, 1);
    expect(result).toMatchObject({ status: 409, body: { operation: "create", outcome: "uncertain", provider_request_id: "request-uncertain" } });
    expect(fake.createAccommodation).toHaveBeenCalledTimes(1);
    expect(CreateResponseSchema.safeParse(result.body).success).toBe(true);
  });

  it.each([[[], "not_found", 200], [[candidate], "found_one", 200], [[candidate, { ...candidate, external_id: "two" }], "found_multiple", 409]] as const)("reconciles zero, one, and multiple matches", async (matches, outcome, status) => {
    const fake = gateway(matches as any); const result = await new AvantioAccommodationService(disabledEnv, fake as any).reconcile(property, 1);
    expect(result).toMatchObject({ status, body: { outcome } }); expect(fake.createAccommodation).not.toHaveBeenCalled();
    expect(ReconcileResponseSchema.safeParse(result.body).success).toBe(true);
  });

  it("normalizes a definite reconciliation rejection", async () => {
    const fake = gateway([]);
    fake.findAccommodationsByExternalReference.mockRejectedValue(new AvantioProviderError("provider_rejected", "provider_http_403", "rejected", "body_received", 403));
    const result = await new AvantioAccommodationService(disabledEnv, fake as any).reconcile(property, 1);
    expect(result).toMatchObject({ status: 422, body: { operation: "reconcile", outcome: "provider_rejected" } });
    expect(fake.createAccommodation).not.toHaveBeenCalled();
  });

  it.each(["create", "reconcile"] as const)("fails %s closed when exact lookup is incomplete", async (operation) => {
    const fake = gateway([]);
    fake.findAccommodationsByExternalReference.mockRejectedValue(new AvantioProviderError("temporarily_unavailable", "missing_authoritative_accommodation_id", "incomplete", "body_received"));
    const service = new AvantioAccommodationService(enabledEnv, fake as any);
    const result = operation === "create" ? await service.create(property, 1) : await service.reconcile(property, 1);
    expect(result).toMatchObject({ status: 503, body: { operation, outcome: "temporarily_unavailable" } });
    expect(fake.createAccommodation).not.toHaveBeenCalled();
  });

  it("fails closed when the D1 index migration is absent", async () => {
    const fake = gateway([]);
    fake.findAccommodationsByExternalReference.mockRejectedValue(new AvantioProviderError("temporarily_unavailable", "accommodation_index_uninitialized", "migration missing", "not_started"));
    const result = await new AvantioAccommodationService(enabledEnv, fake as any).create(property, 1);
    expect(result).toMatchObject({ status: 503, body: { outcome: "temporarily_unavailable" } });
    expect(result.body.errors).toContainEqual(expect.objectContaining({ code: "accommodation_index_uninitialized" }));
    expect(fake.createAccommodation).not.toHaveBeenCalled();
  });
});
