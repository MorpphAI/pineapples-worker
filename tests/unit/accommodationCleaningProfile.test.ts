import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
    buildAccommodationCleaningView,
    deriveSuggestedCleaningProfile,
    normalizeCleaningOverrideInput,
} from "../../src/domain/accommodation/accommodationCleaningProfile";
import { AccommodationCleaningOverrideRepository } from "../../src/repositories/accommodation/accommodationCleaningOverrideRepository";
import { AccommodationRepository } from "../../src/repositories/accommodation/accommodationRepository";
import { GetAccommodationsService } from "../../src/services/v1/accommodation/getAccommodationsService";
import { ResetAccommodationCleaningProfileService } from "../../src/services/v1/accommodation/resetCleaningProfileService";
import { UpdateAccommodationCleaningProfileService } from "../../src/services/v1/accommodation/updateCleaningProfileService";
import { AccommodationCleaningOverrideRow, AccommodationRow } from "../../src/types/accommodationTypes";
import { AccommodationStatus, AvantioAccommodation } from "../../src/types/avantioTypes";

const NOW = "2026-05-04T12:00:00.000Z";

function row(overrides: Partial<AccommodationRow> = {}): AccommodationRow {
    return {
        accommodation_id: "APT1",
        name: "APT1 ZONA1",
        status: "ENABLED",
        area_m2: 80,
        addr_type: "STREET",
        address: "Pine",
        number: "100",
        door: "101",
        city_name: "Rio",
        latitude: null,
        longitude: null,
        last_seen_at: NOW,
        created_at: NOW,
        updated_at: NOW,
        ...overrides,
    };
}

function override(overrides: Partial<AccommodationCleaningOverrideRow> = {}): AccommodationCleaningOverrideRow {
    return {
        accommodation_id: "APT1",
        effort_units: 1,
        estimated_minutes: 40,
        required_people: 1,
        zone_override: "ZONA2",
        address_group_key_override: "CUSTOM|GROUP",
        is_active: 1,
        notes: "Manual exception",
        updated_by: null,
        created_at: NOW,
        updated_at: NOW,
        ...overrides,
    };
}

function accommodation(id: string, name: string, areaM2: number | null = 80): AvantioAccommodation {
    return {
        id,
        galleryId: id,
        name,
        status: AccommodationStatus.ENABLED,
        area: areaM2 == null ? undefined : {
            livingSpace: {
                amount: areaM2,
                unit: "m2",
            },
        },
        location: {
            countryCode: "BR",
            cityName: "Rio",
            postalCode: "00000-000",
            addrType: "STREET",
            address: "Pine",
            number: "100",
            door: "101",
            coordinates: {
                lat: "-22.9",
                lon: "-43.1",
            },
        },
    };
}

async function resetTables() {
    await env.DB.prepare("DELETE FROM accommodation_cleaning_overrides").run();
    await env.DB.prepare("DELETE FROM accommodations").run();
}

describe("accommodation cleaning profile domain", () => {
    it("derives suggested profile from area, name zone, and address fields", () => {
        const suggested = deriveSuggestedCleaningProfile(row());

        expect(suggested).toEqual({
            zone: "ZONA1",
            addressGroupKey: "STREET|PINE|100|RIO",
            effortUnits: 3,
            estimatedMinutes: 120,
            requiredPeople: 1,
            sizeClass: "LARGE",
        });
    });

    it("applies active overrides to the effective profile", () => {
        const view = buildAccommodationCleaningView(row(), override());

        expect(view.override).toEqual(expect.objectContaining({
            effortUnits: 1,
            estimatedMinutes: 40,
            zoneOverride: "ZONA2",
            isActive: true,
        }));
        expect(view.effective).toEqual({
            zone: "ZONA2",
            addressGroupKey: "CUSTOM|GROUP",
            effortUnits: 1,
            estimatedMinutes: 40,
            requiredPeople: 1,
        });
        expect(view.flags.hasOverride).toBe(true);
    });

    it("keeps inactive overrides visible without applying them", () => {
        const view = buildAccommodationCleaningView(row(), override({ is_active: 0 }));

        expect(view.override?.isActive).toBe(false);
        expect(view.effective.estimatedMinutes).toBe(120);
        expect(view.effective.zone).toBe("ZONA1");
        expect(view.flags.hasOverride).toBe(false);
    });

    it("sets missing area, missing zone, and large review flags", () => {
        const missing = buildAccommodationCleaningView(row({
            name: "APT WITHOUT ZONE",
            area_m2: null,
        }), null);
        expect(missing.flags.missingArea).toBe(true);
        expect(missing.flags.missingZone).toBe(true);

        const large = buildAccommodationCleaningView(row({ area_m2: 100 }), null);
        expect(large.flags.largeWithoutReview).toBe(true);
    });

    it("rejects non-editable and invalid override fields", () => {
        expect(() => normalizeCleaningOverrideInput({ estimatedMinutes: 0 })).toThrow("estimatedMinutes");
        expect(() => normalizeCleaningOverrideInput({ effortUnits: 4 })).toThrow("effortUnits");
        expect(() => normalizeCleaningOverrideInput({ randomField: true })).toThrow("Campos nao editaveis");
    });
});

describe("accommodation cleaning profile services", () => {
    beforeEach(async () => {
        await resetTables();
    });

    it("saves, updates, and validates cleaning overrides", async () => {
        await new AccommodationRepository(env.DB).upsertMany([
            accommodation("APT1", "APT1 ZONA1", 80),
        ]);

        const service = new UpdateAccommodationCleaningProfileService(env as any);
        const saved = await service.update("APT1", {
            estimatedMinutes: 40,
            effortUnits: 1,
            requiredPeople: 1,
            notes: "Fast turnover",
        });

        expect(saved?.override).toEqual(expect.objectContaining({
            estimatedMinutes: 40,
            effortUnits: 1,
            notes: "Fast turnover",
        }));
        expect(saved?.effective.estimatedMinutes).toBe(40);

        const updated = await service.update("APT1", {
            estimatedMinutes: null,
            zoneOverride: "ZONA2",
        });
        expect(updated?.override?.estimatedMinutes).toBeUndefined();
        expect(updated?.effective.estimatedMinutes).toBe(120);
        expect(updated?.effective.zone).toBe("ZONA2");

        await expect(service.update("APT1", { estimatedMinutes: -5 })).rejects.toThrow("estimatedMinutes");
    });

    it("resets overrides back to suggested defaults", async () => {
        await new AccommodationRepository(env.DB).upsertMany([
            accommodation("APT1", "APT1 ZONA1", 80),
        ]);
        await new AccommodationCleaningOverrideRepository(env.DB).upsert("APT1", {
            estimatedMinutes: 40,
            effortUnits: 1,
        });

        const reset = await new ResetAccommodationCleaningProfileService(env as any).reset("APT1");

        expect(reset?.override).toBeNull();
        expect(reset?.effective.estimatedMinutes).toBe(120);
        expect(reset?.flags.hasOverride).toBe(false);
    });

    it("returns GET accommodation response shape with suggested, override, effective, and flags", async () => {
        await new AccommodationRepository(env.DB).upsertMany([
            accommodation("APT1", "APT1 ZONA1", 80),
        ]);
        await new AccommodationCleaningOverrideRepository(env.DB).upsert("APT1", {
            estimatedMinutes: 40,
            zoneOverride: "ZONA2",
        });

        const accommodations = await new GetAccommodationsService(env as any).list();

        expect(accommodations).toHaveLength(1);
        expect(accommodations[0]).toEqual(expect.objectContaining({
            accommodationId: "APT1",
            name: "APT1 ZONA1",
            suggested: expect.objectContaining({ zone: "ZONA1", estimatedMinutes: 120 }),
            override: expect.objectContaining({ estimatedMinutes: 40, zoneOverride: "ZONA2" }),
            effective: expect.objectContaining({ zone: "ZONA2", estimatedMinutes: 40 }),
            flags: expect.objectContaining({ hasOverride: true, missingArea: false }),
        }));
    });
});
