import { describe, it, expect } from "vitest";
import { extractDistanceAuditSource } from "../../src/integrations/avantio/accommodations/distanceAuditSource";

describe("distance audit source (Avantio -> PineOS)", () => {
  it("projects source coordinates and provider surroundings without calculating a route", () => {
    expect(extractDistanceAuditSource({
      location: { coordinates: { lat: -22.9, lon: -43.2 } },
      surroundingsAndDistances: { distances: [{ type: "BEACH", distance: 500 }] },
      owner: { tax_id: "must-not-leak" },
    })).toEqual({
      coordinates: { latitude: -22.9, longitude: -43.2 },
      provider_distances: { distances: [{ type: "BEACH", distance: 500 }] },
      provider_path: "surroundingsAndDistances",
    });
  });
  it("accepts numeric strings returned by the provider, as the PineOS mapper does", () => {
    expect(extractDistanceAuditSource({
      location: { coordinates: { lat: "-22.9000", lon: "-43.2000" } },
    }).coordinates).toEqual({ latitude: -22.9, longitude: -43.2 });
  });

  it("rejects missing or invalid coordinates instead of inventing a location", () => {
    expect(extractDistanceAuditSource({ location: { coordinates: { lat: 92, lon: 0 } } }).coordinates).toBeNull();
    expect(extractDistanceAuditSource(null).coordinates).toBeNull();
  });
});
