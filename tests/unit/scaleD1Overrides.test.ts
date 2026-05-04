import { describe, expect, it, vi } from "vitest";
import { ScaleService } from "../../src/services/v1/scale/createScale/PostScaleService";
import { mergeCleaningProfiles } from "../../src/utils/scaleUtils";
import { AccommodationStatus, AvantioAccommodation, AvantioBooking, BookingStatus } from "../../src/types/avantioTypes";
import { Cleaner, CleaningProfileOverride, CleaningTask } from "../../src/types/cleanerTypes";

const DATE = "2026-05-04";

function booking(accommodationId: string): AvantioBooking {
    return {
        id: `${accommodationId}-out`,
        id1: `${accommodationId}-out`,
        reference: `${accommodationId}-out`,
        creationDate: DATE,
        createdAt: DATE,
        updatedAt: DATE,
        stayDates: {
            arrival: "2026-05-01",
            departure: DATE,
        },
        status: BookingStatus.CONFIRMED,
        companyId: "company",
        accommodationId,
        externalData: { reference: `${accommodationId}-out` },
    };
}

function accommodation(id: string, name = "APT WITHOUT ZONE", areaM2 = 100): AvantioAccommodation {
    return {
        id,
        galleryId: id,
        name,
        status: AccommodationStatus.ENABLED,
        area: {
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
            address: "Scale",
            number: "10",
            door: "1",
            coordinates: {
                lat: "-22.9",
                lon: "-43.1",
            },
        },
    };
}

function cleaner(): Cleaner {
    return {
        id: 1,
        name: "Cleaner One",
        zones: "ZONA1,ZONA2",
        shift_start: "08:00",
        shift_end: "17:00",
        is_active: 1,
        created_at: DATE,
        fixed_accommodations: null,
        is_fixed: 0,
    };
}

function buildService(
    profileRows: any[],
    requestProfiles?: CleaningProfileOverride[]
): { service: ScaleService; findAllActive: ReturnType<typeof vi.fn>; savedTasks: CleaningTask[] } {
    const service = new ScaleService({
        DB: {} as D1Database,
        AVANTIO_API_KEY: "",
        AVANTIO_BASE_URL: "",
        API_KEY: "",
    });
    const savedTasks: CleaningTask[] = [];
    const findAllActive = vi.fn(async () => profileRows);

    (service as any).avantioApiGateway = {
        getCheckins: async () => [],
        getCheckouts: async () => [booking("APT1")],
        getAccommodation: async () => accommodation("APT1"),
    };
    (service as any).accommodationRepo = {
        upsertMany: async () => 1,
    };
    (service as any).cleanerRepo = {
        findAllActive: async () => [cleaner()],
    };
    (service as any).offDayRepo = {
        getCleanersOffByDate: async () => [],
    };
    (service as any).scaleRepo = {
        saveScheduleRun: async (_date: string, tasks: CleaningTask[]) => {
            savedTasks.push(...tasks);
            return 123;
        },
    };
    (service as any).overrideRepo = { findAllActive };

    if (requestProfiles) {
        findAllActive.mockRejectedValue(new Error("D1 should not be called when request profiles are present"));
    }

    return { service, findAllActive, savedTasks };
}

describe("scale D1 cleaning overrides", () => {
    it("uses active D1 overrides when request body cleaningProfiles is absent", async () => {
        const { service, findAllActive, savedTasks } = buildService([{
            accommodation_id: "APT1",
            effort_units: 1,
            estimated_minutes: 40,
            required_people: 1,
            zone_override: "ZONA1",
            address_group_key_override: null,
            is_active: 1,
            notes: null,
            updated_by: null,
            created_at: DATE,
            updated_at: DATE,
        }]);

        const result = await service.generateDailySchedule(DATE);

        expect(findAllActive).toHaveBeenCalledTimes(1);
        expect(result.runId).toBe(123);
        expect(savedTasks).toHaveLength(1);
        expect(savedTasks[0].zone).toBe("ZONA1");
        expect(savedTasks[0].effort.estimatedMinutes).toBe(40);
        expect(savedTasks[0].effort.effortUnits).toBe(1);
    });

    it("keeps request-body cleaningProfiles behavior when profiles are present", async () => {
        const { service, findAllActive, savedTasks } = buildService([], [{
            accommodationId: "APT1",
            accommodationName: "APT WITHOUT ZONE",
            effortUnits: 2,
            estimatedMinutes: 90,
            requiredPeople: 1,
            zoneOverride: "ZONA2",
        }]);

        await service.generateDailySchedule(DATE, {
            cleaningProfiles: [{
                accommodationId: "APT1",
                accommodationName: "APT WITHOUT ZONE",
                effortUnits: 2,
                estimatedMinutes: 90,
                requiredPeople: 1,
                zoneOverride: "ZONA2",
            }],
        });

        expect(findAllActive).not.toHaveBeenCalled();
        expect(savedTasks[0].zone).toBe("ZONA2");
        expect(savedTasks[0].effort.estimatedMinutes).toBe(90);
    });

    it("merges profiles with request/body profile precedence by id or normalized name", () => {
        const merged = mergeCleaningProfiles([
            {
                accommodationId: "APT1",
                accommodationName: "Persisted",
                estimatedMinutes: 150,
            },
            {
                accommodationName: "By Name",
                estimatedMinutes: 60,
            },
        ], [
            {
                accommodationId: "APT1",
                accommodationName: "Request",
                estimatedMinutes: 40,
            },
            {
                accommodationName: "by name",
                estimatedMinutes: 30,
            },
        ]);

        expect(merged).toHaveLength(2);
        expect(merged.map(profile => profile.estimatedMinutes).sort()).toEqual([30, 40]);
    });
});
