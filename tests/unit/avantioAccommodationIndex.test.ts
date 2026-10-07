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
        processed_records = 0, processed_pages = 0, last_error_code = NULL,
        lease_owner = NULL, lease_expires_at = NULL
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
    vi.spyOn(AvantioApiGateway.prototype, "getAccommodationsPage")
      .mockResolvedValueOnce({ records: [rawRecord("route-id", "ROUTE")], nextPageUrl: "https://provider.test/accommodations?page=2&token=private" })
      .mockResolvedValueOnce({ records: [], nextPageUrl: null });
    const response = await SELF.fetch("http://local.test/v1/accommodations/sync", { method: "POST", headers: { "x-api-key": "test-key" } });
    const body = await response.json<any>();
    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, synced: 1, complete: true, processed_records: 1, processed_pages: 2, active_generation_available: true, building: false });
    expect(JSON.stringify(body)).not.toContain("next_page_url");
    expect(JSON.stringify(body)).not.toContain("token=private");
  });

  it("fetches at most five bounded list pages per invocation", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      const page = fetchMock.mock.calls.length;
      const records = Array.from({ length: 10 }, (_, index) => rawRecord(`id-${page}-${index}`, `REF-${page}-${index}`));
      return providerResponse({
        data: records,
        _links: { next: `https://provider.test/accommodations?page=${page + 1}` },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new SyncAccommodationsService(env as any).sync();

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("pagination_size")).toBe("50");
    expect(result).toEqual({ synced: 50, complete: false, processed_records: 50, processed_pages: 5, active_generation_available: false, building: true });
  });

  it("indexes records with missing externalReference without per-record detail reads", async () => {
    const records = Array.from({ length: 10 }, (_, index) => rawRecord(`id-${index}`));
    const fetchMock = vi.fn().mockResolvedValue(providerResponse({ data: records }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new SyncAccommodationsService(env as any).sync();
    expect(result.complete).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const nullReferences = await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM avantio_accommodation_reference_index WHERE external_reference IS NULL").first<{ count: number }>();
    expect(nullReferences?.count).toBe(10);
  });

  it("prevents provider calls beyond the internal hard budget", () => {
    const budget = new ProviderSubrequestBudget();
    for (let index = 0; index < ACCOMMODATION_SYNC_MAX_PROVIDER_REQUESTS; index += 1) budget.consume();
    expect(() => budget.consume()).toThrow(expect.objectContaining({ code: "provider_subrequest_budget_exhausted" }));
    expect(budget.count).toBe(ACCOMMODATION_SYNC_MAX_PROVIDER_REQUESTS);
  });

  it("serves newly inspected building records alongside the last complete generation", async () => {
    await seedActive();
    const now = new Date().toISOString();
    await testEnv.DB.prepare(`
      UPDATE avantio_accommodation_index_sync_state
      SET building_generation_id = 'building-now', status = 'building', started_at = ?, updated_at = ?
      WHERE singleton_id = 1
    `).bind(now, now).run();
    await testEnv.DB.prepare(`
      INSERT INTO avantio_accommodation_reference_index
        (generation_id, accommodation_id, external_reference, name, remote_status, inspected_at)
      VALUES
        ('building-now', 'old-id', 'OLD-UPDATED', 'Old updated', 'ENABLED', ?),
        ('building-now', 'new-id', 'NEW', 'New accommodation', 'ENABLED', ?)
    `).bind(now, now).run();

    const page = await new AccommodationReferenceIndexRepository(testEnv.DB)
      .listActiveRecords(10, null);

    expect(page.records).toEqual([
      expect.objectContaining({ accommodation_id: "new-id", external_reference: "NEW" }),
      expect.objectContaining({ accommodation_id: "old-id", external_reference: "OLD-UPDATED" }),
    ]);
  });

  it("resumes the stored cursor across the five-page budget and activates on the final page", async () => {
    await seedActive();
    const fetchMock = vi.fn();
    for (let page = 1; page <= 5; page += 1) {
      fetchMock.mockResolvedValueOnce(providerResponse({
        data: [rawRecord(`new-${page}`, `REF-${page}`)],
        _links: { next: `?page=${page + 1}&cursor=production-relative-${page}` },
      }));
    }
    fetchMock.mockResolvedValueOnce(providerResponse({ data: [rawRecord("new-6", "REF-6")] }));
    vi.stubGlobal("fetch", fetchMock);
    const generation = "new-generation";
    const service = new SyncAccommodationsService(env as any, undefined, undefined, undefined, () => new Date(), () => generation);

    const partial = await service.sync();
    const partialState = await new AccommodationReferenceIndexRepository(testEnv.DB).getState();
    expect(partial).toMatchObject({ synced: 5, complete: false, processed_records: 5, processed_pages: 5, active_generation_available: true, building: true });
    expect(partialState.active_generation_id).toBe("old-active");
    expect(partialState.building_generation_id).toBe(generation);
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get("page")).toBe("2");

    const complete = await service.sync();
    const completeState = await new AccommodationReferenceIndexRepository(testEnv.DB).getState();
    expect(new URL(fetchMock.mock.calls[5][0]).searchParams.get("page")).toBe("6");
    expect(complete).toMatchObject({ synced: 1, complete: true, processed_records: 6, processed_pages: 6, active_generation_available: true, building: false });
    expect(completeState.active_generation_id).toBe(generation);
    expect(completeState.building_generation_id).toBeNull();
    expect((await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM avantio_accommodation_reference_index WHERE generation_id = 'old-active'").first<{ count: number }>())?.count).toBe(0);
  });

  it("persists page one and rebases the production HTTP cursor before advancing page two", async () => {
    const productionEnv = { ...env, AVANTIO_BASE_URL: "https://provider.test/pms/v2" };
    const firstRecords = Array.from({ length: 10 }, (_, index) => rawRecord(`production-${index}`, `REF-${index}`));
    const expectedCursor = "https://provider.test/pms/v2/accommodations?page=2&cursor=opaque%2Fvalue&token=a%2Bb";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(providerResponse({
        data: firstRecords,
        _links: { next: "http://legacy-pagination.test/pms/v2/accommodations?page=2&cursor=opaque%2Fvalue&token=a%2Bb" },
      }))
      .mockResolvedValueOnce(providerResponse({ data: [rawRecord("production-10", "REF-10")] }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new SyncAccommodationsService(productionEnv as any, undefined, undefined, undefined, () => new Date(), () => "production-root-generation");

    const result = await service.sync();

    expect(result).toMatchObject({ synced: 11, complete: true, processed_records: 11, processed_pages: 2, building: false });
    expect(fetchMock.mock.calls[1][0]).toBe(expectedCursor);
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.has("pagination_size")).toBe(false);
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === "GET")).toBe(true);
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
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(providerResponse({
        data: [rawRecord("page-2", "PAGE-2")],
        _links: { next: "/accommodations?page=3&cursor=next" },
      }))
      .mockResolvedValueOnce(providerResponse({ data: [rawRecord("page-3", "PAGE-3")] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new SyncAccommodationsService(env as any).sync();
    const state = await new AccommodationReferenceIndexRepository(testEnv.DB).getState();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://provider.test/accommodations?page=2&cursor=stored");
    expect(fetchMock.mock.calls[1][0]).toBe("https://provider.test/accommodations?page=3&cursor=next");
    expect(result).toMatchObject({ synced: 2, complete: true, processed_records: 12, processed_pages: 3, building: false });
    expect(state.active_generation_id).toBe("production-generation");
    expect(state.building_generation_id).toBeNull();
    expect(state.status).toBe("complete");
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

  it("preserves a list-provided external reference without extra provider reads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(providerResponse({ data: [rawRecord("detail-id", "ExactCase")] }));
    vi.stubGlobal("fetch", fetchMock);
    await new SyncAccommodationsService(env as any).sync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const row = await testEnv.DB.prepare("SELECT accommodation_id, external_reference FROM avantio_accommodation_reference_index").first<{ accommodation_id: string; external_reference: string }>();
    expect(row).toEqual({ accommodation_id: "detail-id", external_reference: "ExactCase" });
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
