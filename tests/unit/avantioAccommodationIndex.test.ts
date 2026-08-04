import { env as testEnv, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvantioApiGateway } from "../../src/apiGateways/avantio/getAppointments";
import { AvantioAccommodationService, CanonicalPropertyV1Schema } from "../../src/integrations/avantio/accommodations";
import { AccommodationReferenceIndexRepository } from "../../src/repositories/accommodation/accommodationReferenceIndexRepository";
import {
  ACCOMMODATION_SYNC_MAX_PROVIDER_REQUESTS,
  AccommodationSyncError,
  ProviderSubrequestBudget,
  SyncAccommodationsService,
} from "../../src/services/v1/accommodation/syncAccommodationsService";
import { productionCanonicalProperty } from "../fixtures/avantioAccommodationCreate";

const env = {
  AVANTIO_API_KEY: "provider-secret",
  AVANTIO_BASE_URL: "https://provider.test",
  AVANTIO_ACCOMMODATION_CREATE_ENABLED: "false",
  AVANTIO_ACCOMMODATION_INDEX_MAX_AGE_SECONDS: "900",
  API_KEY: "test-key",
  DB: testEnv.DB,
};

function providerResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function rawRecord(id: string, externalReference?: string) {
  return {
    id,
    galleryId: `gallery-${id}`,
    ...(externalReference !== undefined ? { externalReference } : {}),
    name: id,
    status: "ENABLED",
    location: { countryCode: "BR", cityName: "Rio", address: "Example", number: "1" },
  };
}

async function resetIndex() {
  await testEnv.DB.prepare("DELETE FROM accommodation_cleaning_overrides").run();
  await testEnv.DB.prepare("DELETE FROM accommodations").run();
  await testEnv.DB.prepare("DELETE FROM avantio_accommodation_reference_index").run();
  await testEnv.DB.prepare(`
    UPDATE avantio_accommodation_index_sync_state
    SET active_generation_id = NULL, building_generation_id = NULL, next_page_url = NULL,
        status = 'idle', started_at = NULL, completed_at = NULL, updated_at = CURRENT_TIMESTAMP,
        processed_records = 0, processed_pages = 0, last_error_code = NULL
    WHERE singleton_id = 1
  `).run();
}

async function seedActive(generation = "old-active") {
  const now = new Date().toISOString();
  await testEnv.DB.prepare(`
    UPDATE avantio_accommodation_index_sync_state
    SET active_generation_id = ?, status = 'complete', completed_at = ?, updated_at = ?
    WHERE singleton_id = 1
  `).bind(generation, now, now).run();
  await testEnv.DB.prepare(`
    INSERT INTO avantio_accommodation_reference_index
      (generation_id, accommodation_id, external_reference, name, remote_status, inspected_at)
    VALUES (?, 'old-id', 'OLD', 'Old', 'ENABLED', ?)
  `).bind(generation, now).run();
}

beforeEach(async () => { vi.restoreAllMocks(); await resetIndex(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("bounded incremental Avantio accommodation index", () => {
  it("returns the incremental public sync response without exposing the cursor", async () => {
    vi.spyOn(AvantioApiGateway.prototype, "getAccommodationsPage").mockResolvedValue({ records: [rawRecord("route-id", "ROUTE")], nextPageUrl: "https://provider.test/accommodations?page=2&token=private" });
    const response = await SELF.fetch("http://local.test/v1/accommodations/sync", { method: "POST", headers: { "x-api-key": "test-key" } });
    const body = await response.json<any>();
    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, synced: 1, complete: false, processed_records: 1, processed_pages: 1, active_generation_available: false, building: true });
    expect(JSON.stringify(body)).not.toContain("next_page_url");
    expect(JSON.stringify(body)).not.toContain("token=private");
  });

  it("fetches at most one bounded list page per invocation", async () => {
    const records = Array.from({ length: 10 }, (_, index) => rawRecord(`id-${index}`, `REF-${index}`));
    const fetchMock = vi.fn().mockResolvedValue(providerResponse({ data: records, _links: { next: "https://provider.test/accommodations?page=2" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new SyncAccommodationsService(env as any).sync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("pagination_size")).toBe("10");
    expect(result).toEqual({ synced: 10, complete: false, processed_records: 10, processed_pages: 1, active_generation_available: false, building: true });
  });

  it("uses at most eleven provider requests for ten records requiring detail hydration", async () => {
    const records = Array.from({ length: 10 }, (_, index) => rawRecord(`id-${index}`));
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (new URL(url).pathname === "/accommodations") return providerResponse({ data: records });
      const id = new URL(url).pathname.split("/").pop()!;
      return providerResponse({ data: rawRecord(id) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new SyncAccommodationsService(env as any).sync();
    expect(result.complete).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(11);
    const nullReferences = await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM avantio_accommodation_reference_index WHERE external_reference IS NULL").first<{ count: number }>();
    expect(nullReferences?.count).toBe(10);
  });

  it("prevents provider calls beyond the internal hard budget", () => {
    const budget = new ProviderSubrequestBudget();
    for (let index = 0; index < ACCOMMODATION_SYNC_MAX_PROVIDER_REQUESTS; index += 1) budget.consume();
    expect(() => budget.consume()).toThrow(expect.objectContaining({ code: "provider_subrequest_budget_exhausted" }));
    expect(budget.count).toBe(ACCOMMODATION_SYNC_MAX_PROVIDER_REQUESTS);
  });

  it("resumes the stored cursor on a second invocation and activates only on the final page", async () => {
    await seedActive();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(providerResponse({ data: [rawRecord("new-1", "ONE")], _links: { next: "?page=2&cursor=production-relative" } }))
      .mockResolvedValueOnce(providerResponse({ data: [rawRecord("new-2", "TWO")] }));
    vi.stubGlobal("fetch", fetchMock);
    const generation = "new-generation";
    const service = new SyncAccommodationsService(env as any, undefined, undefined, undefined, () => new Date(), () => generation);

    const partial = await service.sync();
    const partialState = await new AccommodationReferenceIndexRepository(testEnv.DB).getState();
    expect(partial).toMatchObject({ complete: false, active_generation_available: true, building: true });
    expect(partialState.active_generation_id).toBe("old-active");
    expect(partialState.building_generation_id).toBe(generation);

    const complete = await service.sync();
    const completeState = await new AccommodationReferenceIndexRepository(testEnv.DB).getState();
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get("page")).toBe("2");
    expect(complete).toMatchObject({ complete: true, processed_records: 2, processed_pages: 2, active_generation_available: true, building: false });
    expect(completeState.active_generation_id).toBe(generation);
    expect(completeState.building_generation_id).toBeNull();
    expect((await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM avantio_accommodation_reference_index WHERE generation_id = 'old-active'").first<{ count: number }>())?.count).toBe(0);
  });

  it("resumes a failed production-pattern generation from its stored relative page-2 cursor", async () => {
    const now = new Date().toISOString();
    await testEnv.DB.prepare(`
      UPDATE avantio_accommodation_index_sync_state
      SET building_generation_id = 'production-generation', next_page_url = '?page=2&cursor=stored',
          status = 'failed', started_at = ?, updated_at = ?, processed_records = 10,
          processed_pages = 1, last_error_code = 'accommodation_index_batch_failed'
      WHERE singleton_id = 1
    `).bind(now, now).run();
    const fetchMock = vi.fn().mockResolvedValue(providerResponse({ data: [rawRecord("page-2", "PAGE-2")], _links: { next: "/accommodations?page=3&cursor=next" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new SyncAccommodationsService(env as any).sync();
    const state = await new AccommodationReferenceIndexRepository(testEnv.DB).getState();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://provider.test/accommodations?page=2&cursor=stored");
    expect(result).toMatchObject({ complete: false, processed_records: 11, processed_pages: 2, building: true });
    expect(state.building_generation_id).toBe("production-generation");
    expect(state.next_page_url).toBe("https://provider.test/accommodations?page=3&cursor=next");
    expect(state.status).toBe("building");
  });

  it.each([
    ["missing authoritative ID", { name: "Invalid" }],
    ["galleryId only", { galleryId: "gallery-only", name: "Invalid" }],
  ])("does not activate a batch containing %s", async (_label, record) => {
    await seedActive();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerResponse({ data: [record] })));
    await expect(new SyncAccommodationsService(env as any).sync()).rejects.toMatchObject({ code: "accommodation_index_record_invalid" });
    const state = await new AccommodationReferenceIndexRepository(testEnv.DB).getState();
    expect(state.active_generation_id).toBe("old-active");
    expect(state.building_generation_id).not.toBeNull();
    expect(state.status).toBe("failed");
  });

  it("hydrates a missing reference through one detail request and stores an exact value", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(providerResponse({ data: [rawRecord("detail-id")] }))
      .mockResolvedValueOnce(providerResponse({ data: rawRecord("detail-id", "ExactCase") }));
    vi.stubGlobal("fetch", fetchMock);
    await new SyncAccommodationsService(env as any).sync();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const row = await testEnv.DB.prepare("SELECT accommodation_id, external_reference FROM avantio_accommodation_reference_index").first<{ accommodation_id: string; external_reference: string }>();
    expect(row).toEqual({ accommodation_id: "detail-id", external_reference: "ExactCase" });
  });

  it("retains a resumable generation when detail hydration fails", async () => {
    await seedActive();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(providerResponse({ data: [rawRecord("detail-id")] }))
      .mockResolvedValueOnce(providerResponse({}, 503));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new SyncAccommodationsService(env as any).sync()).rejects.toMatchObject({ code: "accommodation_index_detail_failed" });
    const state = await new AccommodationReferenceIndexRepository(testEnv.DB).getState();
    expect(state.active_generation_id).toBe("old-active");
    expect(state.building_generation_id).not.toBeNull();
    expect(state.last_error_code).toBe("accommodation_index_detail_failed");
  });

  it("updates the existing accommodation cache during each batch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerResponse({ data: [rawRecord("cache-id", "CACHE")] })));
    await new SyncAccommodationsService(env as any).sync();
    const cached = await testEnv.DB.prepare("SELECT accommodation_id, name FROM accommodations WHERE accommodation_id = 'cache-id'").first<{ accommodation_id: string; name: string }>();
    expect(cached).toEqual({ accommodation_id: "cache-id", name: "cache-id" });
  });
});

describe("indexed create and reconcile safety", () => {
  const property = CanonicalPropertyV1Schema.parse(productionCanonicalProperty);

  it.each(["create", "reconcile"] as const)("performs no provider scan or POST when %s has no active index", async (operation) => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const enabled = { ...env, AVANTIO_ACCOMMODATION_CREATE_ENABLED: "true" };
    const service = new AvantioAccommodationService(enabled as any);
    const result = operation === "create" ? await service.create(property, 7) : await service.reconcile(property, 7);
    expect(result).toMatchObject({ status: 503, body: { operation, outcome: "temporarily_unavailable" } });
    expect(result.body.errors).toContainEqual(expect.objectContaining({ code: "accommodation_index_refresh_required" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows the normal create-disabled branch after a fresh complete zero match", async () => {
    const now = new Date().toISOString();
    await testEnv.DB.prepare(`UPDATE avantio_accommodation_index_sync_state SET active_generation_id = 'empty-active', status = 'complete', completed_at = ?, updated_at = ? WHERE singleton_id = 1`).bind(now, now).run();
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const result = await new AvantioAccommodationService(env as any).create(property, 8);
    expect(result).toMatchObject({ status: 503, body: { outcome: "create_disabled", property_version: 8 } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
