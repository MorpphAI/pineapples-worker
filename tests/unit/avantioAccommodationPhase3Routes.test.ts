import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvantioApiGateway } from "../../src/apiGateways/avantio/getAppointments";
import { AccommodationReferenceIndexRepository } from "../../src/repositories/accommodation/accommodationReferenceIndexRepository";
import { SyncAccommodationsService } from "../../src/services/v1/accommodation/syncAccommodationsService";

const authHeaders = { "x-api-key": "test-key" };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(SyncAccommodationsService.prototype, "sync").mockResolvedValue({
    synced: 0,
    complete: false,
    processed_records: 0,
    processed_pages: 0,
    active_generation_available: true,
    building: true,
  });
});

describe("Avantio inbound catalog routes", () => {
  it("lists the active complete catalog snapshot", async () => {
    vi.spyOn(AccommodationReferenceIndexRepository.prototype, "listActiveRecords")
      .mockResolvedValue({
        records: [{
          accommodation_id: "991",
          external_reference: "RIO-991",
          name: "Apartamento 991",
          remote_status: "ENABLED",
          inspected_at: "2026-10-05T20:00:00.000Z",
        }],
        next_cursor: null,
        completed_at: "2026-10-05T20:00:00.000Z",
      });

    const response = await SELF.fetch(
      "http://local.test/v1/avantio/accommodations/catalog?limit=10",
      { headers: authHeaders },
    );

    expect(response.status).toBe(200);
    expect(await response.json<any>()).toMatchObject({
      success: true,
      records: [{
        accommodation_id: "991",
        external_reference: "RIO-991",
        remote_status: "ENABLED",
      }],
      next_cursor: null,
    });
  });

  it("reads live accommodation detail from Avantio", async () => {
    const detail = vi.spyOn(AvantioApiGateway.prototype, "getAccommodationStrict")
      .mockResolvedValue({
        name: "Apartamento 991",
        status: "ENABLED",
        type: "APARTMENT",
      });

    const response = await SELF.fetch(
      "http://local.test/v1/avantio/accommodations/991",
      { headers: authHeaders },
    );

    expect(response.status).toBe(200);
    expect(detail).toHaveBeenCalledWith("991");
    expect(await response.json<any>()).toMatchObject({
      success: true,
      accommodation_id: "991",
      detail: {
        status: "ENABLED",
        type: "APARTMENT",
      },
    });
  });

  it("keeps both inbound routes behind the worker API key", async () => {
    const catalog = await SELF.fetch("http://local.test/v1/avantio/accommodations/catalog");
    const detail = await SELF.fetch("http://local.test/v1/avantio/accommodations/991");
    expect(catalog.status).toBe(401);
    expect(detail.status).toBe(401);
  });

  it("publishes inbound routes and no outbound create/reconcile/readiness routes", async () => {
    const response = await SELF.fetch("http://local.test/openapi.json", { headers: authHeaders });
    expect(response.status).toBe(200);
    const document = await response.json<any>();

    expect(document.paths).toHaveProperty("/v1/avantio/accommodations/catalog");
    expect(document.paths).toHaveProperty("/v1/avantio/accommodations/{id}");
    expect(document.paths).not.toHaveProperty("/v1/avantio/accommodations/create");
    expect(document.paths).not.toHaveProperty("/v1/avantio/accommodations/reconcile");
    expect(document.paths).not.toHaveProperty("/v1/avantio/accommodations/readiness");
  });
});
