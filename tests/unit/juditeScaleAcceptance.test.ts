import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { BaseScaleService } from "../../src/services/v1/scale/BaseScaleService";
import { GenerateReport } from "../../src/utils/generateReport";
import {
    buildCleaningBundles,
    classifyCleaningRequirement,
    cleanerCanWorkZone,
    extractCheckInTimeMinutes,
    getDeadlineMinutes,
    parseTimeLike,
} from "../../src/utils/scaleUtils";
import { AccommodationStatus, AvantioAccommodation, AvantioBooking, BookingStatus } from "../../src/types/avantioTypes";
import { Cleaner, CleaningProfileOverride, CleaningTask } from "../../src/types/cleanerTypes";

const DATE = "2026-04-29";

function booking(accommodationId: string, status: BookingStatus, overrides: Partial<AvantioBooking> = {}): AvantioBooking {
    return {
        id: `${accommodationId}-${status}`,
        id1: `${accommodationId}-${status}`,
        reference: `${accommodationId}-${status}`,
        creationDate: DATE,
        createdAt: DATE,
        updatedAt: DATE,
        stayDates: {
            arrival: DATE,
            departure: DATE,
        },
        status,
        companyId: "company",
        accommodationId,
        externalData: { reference: `${accommodationId}-${status}` },
        ...overrides,
    };
}

function accommodation(
    id: string,
    name: string,
    areaM2: number,
    address = "Acceptance",
    number = "100",
    door = "1",
): AvantioAccommodation {
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
            address,
            number,
            door,
            coordinates: {
                lat: "-22.9",
                lon: "-43.1",
            },
        },
    };
}

function cleaner(id: number, name: string, zones = "ZONA1", overrides: Partial<Cleaner> = {}): Cleaner {
    return {
        id,
        name,
        zones,
        shift_start: "08:00",
        shift_end: "17:00",
        is_active: 1,
        created_at: DATE,
        fixed_accommodations: null,
        is_fixed: 0,
        ...overrides,
    };
}

function task(
    name: string,
    effortUnits: 1 | 2 | 3,
    estimatedMinutes: number,
    requiredPeople: 1 | 2 | 3 = 1,
    addressGroupKey = "STREET|ACCEPTANCE|100|RIO",
): CleaningTask {
    return {
        accommodationId: name,
        accommodationName: name,
        zone: "ZONA1",
        checkInDate: DATE,
        checkOutDate: DATE,
        isTurnover: true,
        cleaningRequirement: "GUEST_TURNOVER",
        stayDuration: 2,
        areaM2: effortUnits === 1 ? 30 : effortUnits === 2 ? 50 : 90,
        effort: {
            effortUnits,
            estimatedMinutes,
            requiredPeople,
            sizeClass: effortUnits === 1 ? "SMALL" : effortUnits === 2 ? "MEDIUM" : "LARGE",
        },
        priorityScore: 1000 + effortUnits,
        deadlineMinutes: 15 * 60,
        address: "Rua Acceptance, No 100 AP 1 - Rio",
        addressGroupKey,
        latitude: null,
        longitude: null,
    };
}

class JuditeHarness extends BaseScaleService {
    constructor(
        private accommodations: Record<string, AvantioAccommodation>,
        private checkouts: AvantioBooking[],
        private checkins: AvantioBooking[],
        cleaners: Cleaner[],
        private offIds: number[] = [],
    ) {
        super({} as any);
        this.avantioApiGateway = {
            getCheckins: async () => this.checkins,
            getCheckouts: async () => this.checkouts,
            getAccommodation: async (id: string) => this.accommodations[id] || null,
        } as any;
        this.cleanerRepo = { findAllActive: async () => cleaners } as any;
        this.offDayRepo = { getCleanersOffByDate: async () => this.offIds } as any;
    }

    async generate(cleaningProfiles: CleaningProfileOverride[] = []) {
        this.resetWarnings([]);
        const { checkins, checkouts } = await this.fetchAndFilterBookings(DATE);
        const turnoverIds = this.identifyTurnovers(checkins, checkouts);
        const idsToClean = this.getAccommodationIdsToClean(checkouts, checkins);
        const tasks = await this.enrichAndBuildTasks(idsToClean, checkins, checkouts, turnoverIds, cleaningProfiles);
        const prioritized = this.prioritizeTasks(tasks);
        return this.allocateTasksToCleaners(prioritized, DATE);
    }
}

class AllocationHarness extends BaseScaleService {
    constructor(cleaners: Cleaner[], offIds: number[] = []) {
        super({} as any);
        this.cleanerRepo = { findAllActive: async () => cleaners } as any;
        this.offDayRepo = { getCleanersOffByDate: async () => offIds } as any;
    }

    allocate(tasks: CleaningTask[]) {
        this.resetWarnings([]);
        return this.allocateTasksToCleaners(tasks, DATE);
    }
}

describe("Judite scale acceptance", () => {
    it("groups three same-address small apartments into one cleaner assignment", async () => {
        const accommodations = {
            TEST101: accommodation("TEST101", "TEST101 ZONA1", 30, "Same", "10", "101"),
            TEST102: accommodation("TEST102", "TEST102 ZONA1", 30, "Same", "10", "102"),
            TEST103: accommodation("TEST103", "TEST103 ZONA1", 30, "Same", "10", "103"),
        };
        const profiles: CleaningProfileOverride[] = Object.keys(accommodations).map(accommodationId => ({
            accommodationId,
            accommodationName: accommodations[accommodationId].name,
            effortUnits: 1,
            estimatedMinutes: 60,
            requiredPeople: 1,
        }));
        const harness = new JuditeHarness(
            accommodations,
            Object.keys(accommodations).map(id => booking(id, BookingStatus.CONFIRMED)),
            Object.keys(accommodations).map(id => booking(id, BookingStatus.CONFIRMED)),
            [cleaner(1, "Cleaner One")],
        );

        const result = await harness.generate(profiles);

        expect(result.summary.totalBundles).toBe(1);
        expect(new Set(result.tasks.map(item => item.cleanerName))).toEqual(new Set(["Cleaner One"]));
        expect(result.summary.extraCleanersNeeded).toBe(0);
        expect(result.summary.unallocatedCount).toBe(0);
    });

    it("uses runtime profile to configure a large apartment as one person", async () => {
        const harness = new JuditeHarness(
            { TEST_LARGE_ONE: accommodation("TEST_LARGE_ONE", "TEST_LARGE_ONE ZONA1", 120) },
            [booking("TEST_LARGE_ONE", BookingStatus.CONFIRMED)],
            [],
            [cleaner(1, "Cleaner One")],
        );

        const result = await harness.generate([{
            accommodationName: "TEST_LARGE_ONE ZONA1",
            effortUnits: 3,
            estimatedMinutes: 150,
            requiredPeople: 1,
        }]);

        expect(result.tasks[0].effort.effortUnits).toBe(3);
        expect(result.tasks[0].effort.requiredPeople).toBe(1);
        expect(result.tasks[0].cleanerName).toBe("Cleaner One");
        expect(result.tasks[0].cleanerName).not.toContain("&");
        expect(result.summary.extraCleanersNeeded).toBe(0);
    });

    it("uses runtime profile to require two people for a large apartment", async () => {
        const harness = new JuditeHarness(
            { TEST_LARGE_TWO: accommodation("TEST_LARGE_TWO", "TEST_LARGE_TWO ZONA1", 120) },
            [booking("TEST_LARGE_TWO", BookingStatus.CONFIRMED)],
            [],
            [cleaner(1, "Cleaner One"), cleaner(2, "Cleaner Two")],
        );

        const result = await harness.generate([{
            accommodationName: "TEST_LARGE_TWO ZONA1",
            effortUnits: 3,
            estimatedMinutes: 180,
            requiredPeople: 2,
        }]);

        expect(result.tasks[0].effort.requiredPeople).toBe(2);
        expect(result.tasks[0].cleanerName).toBe("Cleaner One & Cleaner Two");
        expect(result.summary.extraCleanersNeeded).toBe(0);
    });

    it("groups one medium and one small same-address apartment for one cleaner", async () => {
        const tasks = [
            task("TEST_MEDIUM", 2, 90),
            task("TEST_SMALL", 1, 60),
        ];

        const bundles = buildCleaningBundles(tasks, DATE);
        const result = await new AllocationHarness([cleaner(1, "Cleaner One")]).allocate(tasks);

        expect(bundles).toHaveLength(1);
        expect(bundles[0].totalEffortUnits).toBe(3);
        expect(new Set(result.tasks.map(item => item.cleanerName))).toEqual(new Set(["Cleaner One"]));
        expect(result.summary.extraCleanersNeeded).toBe(0);
    });

    it("uses apartment-specific 40 minute runtime profile", async () => {
        const harness = new JuditeHarness(
            { TEST_40MIN: accommodation("TEST_40MIN", "TEST_40MIN ZONA1", 80) },
            [booking("TEST_40MIN", BookingStatus.CONFIRMED)],
            [],
            [cleaner(1, "Cleaner One")],
        );

        const result = await harness.generate([{
            accommodationName: "TEST_40MIN ZONA1",
            effortUnits: 1,
            estimatedMinutes: 40,
            requiredPeople: 1,
        }]);

        expect(result.tasks[0].effort.estimatedMinutes).toBe(40);
        expect(result.tasks[0].startTime).toBe("08:00");
        expect(result.tasks[0].endTime).toBe("08:40");
    });

    it("calculates extra cleaners after off-days when extras can solve demand", async () => {
        const tasks = [
            task("DEMAND1", 3, 180, 1, "A"),
            task("DEMAND2", 3, 180, 1, "B"),
            task("DEMAND3", 3, 180, 1, "C"),
        ];
        const harness = new AllocationHarness([
            cleaner(1, "Off Cleaner"),
            cleaner(2, "Available Cleaner"),
        ], [1]);

        const result = await harness.allocate(tasks);

        expect(result.summary.availableCleaners).toBe(1);
        expect(result.summary.cleanersOff).toBe(1);
        expect(result.summary.extraCleanersNeeded).toBeGreaterThan(0);
        expect(result.summary.extraCleanersByZone.ZONA1).toBeGreaterThan(0);
        expect(result.summary.unallocatedCount).toBe(0);
    });

    it("does not inflate extras to the safety limit when a bundle is impossible", async () => {
        const impossible = task("IMPOSSIBLE", 1, 60);
        impossible.deadlineMinutes = 8 * 60 + 30;

        const result = await new AllocationHarness([cleaner(1, "Cleaner One")]).allocate([impossible]);

        expect(result.summary.extraCleanersNeeded).toBeLessThan(20);
        expect(result.summary.unallocatedCount).toBeGreaterThan(0);
        expect(result.summary.warnings.length).toBeGreaterThan(0);
    });

    it("skips owner extension and generates no normal OUT-IN cleaning", async () => {
        const harness = new JuditeHarness(
            { OWNER_EXT: accommodation("OWNER_EXT", "OWNER_EXT ZONA1", 50) },
            [booking("OWNER_EXT", BookingStatus.OWNER)],
            [booking("OWNER_EXT", BookingStatus.OWNER)],
            [cleaner(1, "Cleaner One")],
        );

        const result = await harness.generate([]);

        expect(classifyCleaningRequirement(booking("OWNER_EXT", BookingStatus.OWNER), booking("OWNER_EXT", BookingStatus.OWNER))).toBe("OWNER_EXTENSION");
        expect(result.tasks).toHaveLength(0);
        expect(result.summary.totalBundles).toBe(0);
    });

    it("requires cleaning for owner checkout to guest checkin", async () => {
        const harness = new JuditeHarness(
            { OWNER_TO_GUEST: accommodation("OWNER_TO_GUEST", "OWNER_TO_GUEST ZONA1", 50) },
            [booking("OWNER_TO_GUEST", BookingStatus.OWNER)],
            [booking("OWNER_TO_GUEST", BookingStatus.CONFIRMED)],
            [cleaner(1, "Cleaner One")],
        );

        const result = await harness.generate([]);

        expect(result.tasks).toHaveLength(1);
        expect(result.tasks[0].cleaningRequirement).toBe("OWNER_TO_GUEST");
        expect(result.tasks[0].priorityScore).toBeGreaterThanOrEqual(1000);
    });

    it("requires cleaning for guest checkout to owner checkin and keeps it distinguishable", async () => {
        const harness = new JuditeHarness(
            { GUEST_TO_OWNER: accommodation("GUEST_TO_OWNER", "GUEST_TO_OWNER ZONA1", 50) },
            [booking("GUEST_TO_OWNER", BookingStatus.CONFIRMED)],
            [booking("GUEST_TO_OWNER", BookingStatus.OWNER)],
            [cleaner(1, "Cleaner One")],
        );

        const result = await harness.generate([]);

        expect(result.tasks).toHaveLength(1);
        expect(result.tasks[0].cleaningRequirement).toBe("GUEST_TO_OWNER");
    });

    it("parses late/early time fields as embedded local time", () => {
        const checkin1530 = booking("TIME", BookingStatus.CONFIRMED, { expectedArrivalTime: "2026-04-29T15:30:00-03:00" });
        const checkin0800 = booking("TIME", BookingStatus.CONFIRMED, { expectedArrivalTime: "2026-04-29T08:00:00Z" });

        expect(parseTimeLike("15:30")).toBe(930);
        expect(parseTimeLike("15:30:00")).toBe(930);
        expect(extractCheckInTimeMinutes(checkin1530)).toBe(930);
        expect(extractCheckInTimeMinutes(checkin0800)).toBe(480);
        expect(getDeadlineMinutes("GUEST_TURNOVER", checkin1530)).toBe(870);
    });

    it("uses exact zone token matching", () => {
        expect(cleanerCanWorkZone({ zones: "ZONA1,ZONA2" }, "ZONA10")).toBe(false);
    });

    it("keeps export columns consumed by n8n", () => {
        const base64 = new GenerateReport().generateScheduleReport(DATE, [task("EXPORT", 1, 60)]);
        const workbook = XLSX.read(Buffer.from(base64, "base64"), { type: "buffer" });
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Geral);

        expect(Object.keys(rows[0] as any)).toEqual(expect.arrayContaining([
            "Zona",
            "Código Imóvel",
            "Tipo",
            "Profissional",
            "Início",
            "Fim",
            "Estadia (dias)",
            "Endereço",
            "Prioridade",
        ]));
    });
});
