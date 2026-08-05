import {
  createExecutionContext,
  createScheduledController,
  env as testEnv,
  SELF,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvantioApiGateway, AvantioAccommodationPage } from "../../src/apiGateways/avantio/getAppointments";
import worker from "../../src/index";
import { AccommodationReferenceIndexRepository } from "../../src/repositories/accommodation/accommodationReferenceIndexRepository";
import { SyncAccommodationsService } from "../../src/services/v1/accommodation/syncAccommodationsService";

const env = {
  AVANTIO_API_KEY: "provider-secret",
  AVANTIO_BASE_URL: "https://provider.test/pms/v2",
  AVANTIO_ACCOMMODATION_CREATE_ENABLED: "false",
  AVANTIO_ACCOMMODATION_INDEX_MAX_AGE_SECONDS: "14400",
  API_KEY: "test-key",
  DB: testEnv.DB,
};

function rawRecord(id: string, reference = `REF-${id}`) {
  return {
    id,
    externalReference: reference,
    name: id,
    status: "ENABLED",
    location: { countryCode: "BR", cityName: "Rio", address: "Example", number: "1" },
  };
}

async function resetIndex() {
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

async function setActive(completedAt: string, status: "complete" | "building" | "failed" = "complete") {
  await testEnv.DB.prepare(`
    UPDATE avantio_accommodation_index_sync_state
    SET active_generation_id = 'active-generation', building_generation_id = ?, status = ?,
        started_at = ?, completed_at = ?, updated_at = ?, processed_records = 1289,
        processed_pages = 129, last_error_code = NULL
    WHERE singleton_id = 1
  `).bind(status === "complete" ? null : "replacement-generation", status, completedAt, completedAt, completedAt).run();
}

async function runScheduled() {
  const ctx = createExecutionContext();
  worker.scheduled(createScheduledController({ cron: "* * * * *" }), testEnv as any, ctx);
  await waitOnExecutionContext(ctx);
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetIndex();
});

afterEach(() => vi.unstubAllGlobals());

describe("Avantio accommodation index status", () => {
  it("is authenticated, read-only, and fresh for a recent complete generation", async () => {
    const completedAt = new Date(Date.now() - 60_000).toISOString();
    await setActive(completedAt);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const unauthorized = await SELF.fetch("http://local.test/v1/accommodations/index/status");
    const response = await SELF.fetch("http://local.test/v1/accommodations/index/status", {
      headers: { "x-api-key": "test-key" },
    });
    const body = await response.json<any>();

    expect(unauthorized.status).toBe(401);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      status: "complete",
      active_generation_available: true,
      building: false,
      processed_records: 1289,
      processed_pages: 129,
      completed_at: completedAt,
      max_age_seconds: 14400,
      fresh: true,
      last_error_code: null,
    });
    expect(body.age_seconds).toBeGreaterThanOrEqual(59);
    expect(body).not.toHaveProperty("next_page_url");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports stale after 14400 seconds and unavailable without an active generation", async () => {
    await setActive(new Date(Date.now() - 14_401_000).toISOString());
    const stale = await SELF.fetch("http://local.test/v1/accommodations/index/status", { headers: { "x-api-key": "test-key" } });
    expect(await stale.json<any>()).toMatchObject({ active_generation_available: true, max_age_seconds: 14400, fresh: false });

    await resetIndex();
    const unavailable = await SELF.fetch("http://local.test/v1/accommodations/index/status", { headers: { "x-api-key": "test-key" } });
    expect(await unavailable.json<any>()).toMatchObject({
      status: "idle",
      active_generation_available: false,
      age_seconds: null,
      fresh: false,
    });
  });
});

describe("scheduled Avantio accommodation index refresh", () => {
  it("executes exactly one read-only sync batch", async () => {
    const pageSpy = vi.spyOn(AvantioApiGateway.prototype, "getAccommodationsPage")
      .mockResolvedValue({ records: [rawRecord("scheduled-1")], nextPageUrl: "https://provider.test/pms/v2/accommodations?page=2" });
    const createSpy = vi.spyOn(AvantioApiGateway.prototype, "createAccommodation");

    await runScheduled();

    const state = await new AccommodationReferenceIndexRepository(testEnv.DB).getState();
    expect(pageSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).not.toHaveBeenCalled();
    expect(state).toMatchObject({ status: "building", processed_records: 1, processed_pages: 1 });
  });

  it("resumes a failed generation without restarting it", async () => {
    const now = new Date().toISOString();
    await testEnv.DB.prepare(`
      UPDATE avantio_accommodation_index_sync_state
      SET building_generation_id = 'failed-generation', next_page_url = 'https://provider.test/pms/v2/accommodations?page=2',
          status = 'failed', started_at = ?, updated_at = ?, processed_records = 10,
          processed_pages = 1, last_error_code = 'accommodation_index_batch_failed'
      WHERE singleton_id = 1
    `).bind(now, now).run();
    vi.spyOn(AvantioApiGateway.prototype, "getAccommodationsPage")
      .mockResolvedValue({ records: [rawRecord("scheduled-11")], nextPageUrl: null });

    await runScheduled();

    const state = await new AccommodationReferenceIndexRepository(testEnv.DB).getState();
    expect(state).toMatchObject({
      active_generation_id: "failed-generation",
      building_generation_id: null,
      status: "complete",
      processed_records: 11,
      processed_pages: 2,
    });
  });

  it("starts a new generation on the invocation after completion", async () => {
    vi.spyOn(AvantioApiGateway.prototype, "getAccommodationsPage")
      .mockResolvedValueOnce({ records: [rawRecord("first")], nextPageUrl: null })
      .mockResolvedValueOnce({ records: [rawRecord("second")], nextPageUrl: null });

    await runScheduled();
    const first = await new AccommodationReferenceIndexRepository(testEnv.DB).getState();
    await runScheduled();
    const second = await new AccommodationReferenceIndexRepository(testEnv.DB).getState();

    expect(first.status).toBe("complete");
    expect(second.status).toBe("complete");
    expect(second.active_generation_id).not.toBe(first.active_generation_id);
  });

  it("keeps the old active generation usable while a replacement builds", async () => {
    const completedAt = new Date().toISOString();
    await setActive(completedAt);
    await testEnv.DB.prepare(`
      INSERT INTO avantio_accommodation_reference_index
        (generation_id, accommodation_id, external_reference, name, remote_status, inspected_at)
      VALUES ('active-generation', 'active-id', 'ACTIVE', 'Active', 'ENABLED', ?)
    `).bind(completedAt).run();
    vi.spyOn(AvantioApiGateway.prototype, "getAccommodationsPage")
      .mockResolvedValue({ records: [rawRecord("replacement")], nextPageUrl: "https://provider.test/pms/v2/accommodations?page=2" });

    await runScheduled();

    const repository = new AccommodationReferenceIndexRepository(testEnv.DB);
    const state = await repository.getState();
    expect(state.active_generation_id).toBe("active-generation");
    expect(state.building_generation_id).not.toBeNull();
    expect(await repository.findFreshExactMatches("ACTIVE", 14400)).toHaveLength(1);
  });

  it("logs scheduled failures without cursor or provider body data", async () => {
    const secretText = "cursor=private-token provider-body-secret";
    vi.spyOn(AvantioApiGateway.prototype, "getAccommodationsPage").mockRejectedValue(new Error(secretText));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await runScheduled();

    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain("accommodation_index_batch_failed");
    expect(logged).not.toContain("private-token");
    expect(logged).not.toContain("provider-body-secret");
  });
});

describe("Avantio accommodation index batch lease", () => {
  it("prevents a lease-lost completion from writing or deleting index generations", async () => {
    const now = new Date().toISOString();
    await setActive(now, "building");
    await testEnv.DB.prepare(`
      INSERT INTO avantio_accommodation_reference_index
        (generation_id, accommodation_id, external_reference, name, remote_status, inspected_at)
      VALUES ('active-generation', 'active-id', 'ACTIVE', 'Active', 'ENABLED', ?)
    `).bind(now).run();
    await testEnv.DB.prepare(`
      UPDATE avantio_accommodation_index_sync_state
      SET lease_owner = 'current-owner', lease_expires_at = ?
      WHERE singleton_id = 1
    `).bind(new Date(Date.now() + 60_000).toISOString()).run();
    const repository = new AccommodationReferenceIndexRepository(testEnv.DB);

    await expect(repository.savePage("replacement-generation", [{
      accommodation_id: "stale-id",
      external_reference: "STALE",
      name: "Stale",
      remote_status: "ENABLED",
      inspected_at: now,
    }], null, now, "stale-owner")).rejects.toMatchObject({ code: "accommodation_index_lease_lost" });

    const rows = await testEnv.DB.prepare(`
      SELECT generation_id, accommodation_id
      FROM avantio_accommodation_reference_index
      ORDER BY generation_id, accommodation_id
    `).all();
    expect(rows.results).toEqual([{ generation_id: "active-generation", accommodation_id: "active-id" }]);
    expect((await repository.getState()).active_generation_id).toBe("active-generation");
  });

  it("prevents overlapping invocations from processing or counting one page twice", async () => {
    let resolvePage!: (page: AvantioAccommodationPage) => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const delayedPage = new Promise<AvantioAccommodationPage>((resolve) => { resolvePage = resolve; });
    const firstGateway = {
      getAccommodationsPage: vi.fn(async () => { signalStarted(); return delayedPage; }),
      getAccommodationStrict: vi.fn(),
    };
    const secondGateway = { getAccommodationsPage: vi.fn(), getAccommodationStrict: vi.fn() };
    const first = new SyncAccommodationsService(env as any, firstGateway, undefined, undefined, () => new Date(), () => "generation", () => "lease-one");
    const second = new SyncAccommodationsService(env as any, secondGateway, undefined, undefined, () => new Date(), () => "other-generation", () => "lease-two");

    const firstRun = first.sync();
    await started;
    await expect(second.sync()).rejects.toMatchObject({ code: "accommodation_index_busy" });
    resolvePage({ records: [rawRecord("only-once")], nextPageUrl: "https://provider.test/pms/v2/accommodations?page=2" });
    await firstRun;

    const state = await new AccommodationReferenceIndexRepository(testEnv.DB).getState();
    expect(firstGateway.getAccommodationsPage).toHaveBeenCalledTimes(1);
    expect(secondGateway.getAccommodationsPage).not.toHaveBeenCalled();
    expect(state).toMatchObject({ processed_records: 1, processed_pages: 1 });
  });

  it("recovers a stale lease", async () => {
    await testEnv.DB.prepare(`
      UPDATE avantio_accommodation_index_sync_state
      SET lease_owner = 'crashed-worker', lease_expires_at = ?
      WHERE singleton_id = 1
    `).bind(new Date(Date.now() - 60_000).toISOString()).run();
    const gateway = {
      getAccommodationsPage: vi.fn().mockResolvedValue({ records: [rawRecord("recovered")], nextPageUrl: null }),
      getAccommodationStrict: vi.fn(),
    };

    const result = await new SyncAccommodationsService(env as any, gateway).sync();

    expect(result).toMatchObject({ complete: true, processed_records: 1, processed_pages: 1 });
    expect(gateway.getAccommodationsPage).toHaveBeenCalledTimes(1);
  });

  it("keeps the authenticated HTTP sync endpoint working", async () => {
    const pageSpy = vi.spyOn(AvantioApiGateway.prototype, "getAccommodationsPage")
      .mockResolvedValue({ records: [rawRecord("manual")], nextPageUrl: "https://provider.test/pms/v2/accommodations?page=2" });

    const response = await SELF.fetch("http://local.test/v1/accommodations/sync", {
      method: "POST",
      headers: { "x-api-key": "test-key" },
    });

    expect(response.status).toBe(200);
    expect(await response.json<any>()).toMatchObject({ success: true, synced: 1, processed_pages: 1 });
    expect(pageSpy).toHaveBeenCalledTimes(1);
  });
});
