import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { BaseScaleService } from "../../src/services/v1/scale/BaseScaleService";
import { GenerateReport } from "../../src/utils/generateReport";
import {
    applyCleaningProfile,
    buildCleaningBundles,
    calculateCleaningEffort,
    classifyCleaningRequirement,
    cleanerCanWorkZone,
    extractCheckInTimeMinutes,
    getDeadlineMinutes,
    haversineDistanceKm,
    normalizeCleaningProfiles,
    travelMinutesByDistance,
} from "../../src/utils/scaleUtils";
import { AccommodationStatus, AvantioAccommodation, AvantioBooking, BookingStatus } from "../../src/types/avantioTypes";
import { Cleaner, CleaningProfileOverride, CleaningTask } from "../../src/types/cleanerTypes";

const DATE = "2026-04-05";

function booking(accommodationId: string, status: BookingStatus): AvantioBooking {
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
    };
}

function task(
    accommodationName: string,
    effortUnits: 1 | 2 | 3,
    estimatedMinutes: number,
    addressGroupKey = "STREET|PINE|100|RIO",
    requiredPeople: 1 | 2 | 3 = 1,
): CleaningTask {
    return {
        accommodationId: accommodationName,
        accommodationName,
        zone: "ZONA1",
        checkInDate: DATE,
        checkOutDate: DATE,
        isTurnover: true,
        cleaningRequirement: "GUEST_TURNOVER",
        stayDuration: 2,
        areaM2: effortUnits === 1 ? 30 : effortUnits === 2 ? 50 : 80,
        effort: {
            effortUnits,
            estimatedMinutes,
            requiredPeople,
            sizeClass: effortUnits === 1 ? "SMALL" : effortUnits === 2 ? "MEDIUM" : "LARGE",
        },
        priorityScore: 1000 + effortUnits,
        deadlineMinutes: 15 * 60,
        address: "Rua Pine, No 100 AP 1 - Rio",
        addressGroupKey,
        latitude: null,
        longitude: null,
    };
}

function cleaner(id: number, name: string, zones = "ZONA1"): Cleaner {
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
    };
}

class AllocationHarness extends BaseScaleService {
    constructor(cleaners: Cleaner[], offIds: number[] = []) {
        super({} as any);
        this.cleanerRepo = { findAllActive: async () => cleaners } as any;
        this.offDayRepo = { getCleanersOffByDate: async () => offIds } as any;
    }

    allocate(tasks: CleaningTask[]) {
        return this.allocateTasksToCleaners(tasks, DATE);
    }
}

function accommodation(id: string, name: string, areaM2: number): AvantioAccommodation {
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
            address: "Pine",
            number: "100",
            door: "1",
            coordinates: {
                lat: "-22.9",
                lon: "-43.1",
            },
        },
    };
}

class GenerationHarness extends BaseScaleService {
    constructor(
        private accommodations: Record<string, AvantioAccommodation>,
        private checkouts: AvantioBooking[],
        private checkins: AvantioBooking[],
        cleaners: Cleaner[] = [cleaner(1, "Cleaner One")]
    ) {
        super({} as any);
        this.avantioApiGateway = {
            getCheckins: async () => this.checkins,
            getCheckouts: async () => this.checkouts,
            getAccommodation: async (id: string) => this.accommodations[id] || null,
        } as any;
        this.cleanerRepo = { findAllActive: async () => cleaners } as any;
        this.offDayRepo = { getCleanersOffByDate: async () => [] } as any;
    }

    async generate(cleaningProfiles: CleaningProfileOverride[] = []) {
        this.resetWarnings([]);
        const { checkins, checkouts } = await this.fetchAndFilterBookings(DATE);
        const turnoverIds = this.identifyTurnovers(checkins, checkouts);
        const idsToClean = this.getAccommodationIdsToClean(checkouts, checkins);
        const tasks = await this.enrichAndBuildTasks(idsToClean, checkins, checkouts, turnoverIds, cleaningProfiles);
        return this.allocateTasksToCleaners(this.prioritizeTasks(tasks), DATE);
    }
}

describe("calculateCleaningEffort", () => {
    it("uses effort-unit fallback without treating size as business staffing truth", () => {
        expect(calculateCleaningEffort(30)).toEqual({
            effortUnits: 1,
            estimatedMinutes: 60,
            requiredPeople: 1,
            sizeClass: "SMALL",
        });
        expect(calculateCleaningEffort(50)).toEqual({
            effortUnits: 2,
            estimatedMinutes: 90,
            requiredPeople: 1,
            sizeClass: "MEDIUM",
        });
        expect(calculateCleaningEffort(80)).toEqual({
            effortUnits: 3,
            estimatedMinutes: 120,
            requiredPeople: 1,
            sizeClass: "LARGE",
        });
    });

    it("keeps long-stay minute additions without changing required people", () => {
        expect(calculateCleaningEffort(80, 8)).toEqual({
            effortUnits: 3,
            estimatedMinutes: 150,
            requiredPeople: 1,
            sizeClass: "LARGE",
        });
    });
});

describe("runtime cleaning profiles", () => {
    it("keeps backward compatibility when no body/profiles are sent", () => {
        expect(normalizeCleaningProfiles(undefined)).toEqual({ profiles: [], warnings: [] });
        expect(normalizeCleaningProfiles({} as any)).toEqual({ profiles: [], warnings: [] });
    });

    it("normalizes valid rows and ignores invalid rows with warnings", () => {
        const result = normalizeCleaningProfiles([
            { accommodationName: "A303", effortUnits: "3", estimatedMinutes: "150", requiredPeople: "1", isActive: "TRUE" },
            { accommodationName: "Inactive", isActive: false },
            { accommodationName: "Bad", effortUnits: 7 },
        ]);

        expect(result.profiles).toEqual([
            expect.objectContaining({
                accommodationName: "A303",
                effortUnits: 3,
                estimatedMinutes: 150,
                requiredPeople: 1,
            }),
        ]);
        expect(result.warnings.length).toBe(1);
    });

    it("applies profile effort and time overrides", () => {
        const fallback = calculateCleaningEffort(80);
        expect(applyCleaningProfile(fallback, {
            accommodationName: "A303",
            effortUnits: 3,
            estimatedMinutes: 150,
            requiredPeople: 1,
        })).toEqual({
            effortUnits: 3,
            estimatedMinutes: 150,
            requiredPeople: 1,
            sizeClass: "CUSTOM",
        });

        expect(applyCleaningProfile(fallback, {
            accommodationName: "NSC1109",
            estimatedMinutes: 40,
            requiredPeople: 1,
        }).estimatedMinutes).toBe(40);
    });

    it("preserves requiredPeople from the sheet as authoritative", () => {
        const fallback = calculateCleaningEffort(120);
        expect(applyCleaningProfile(fallback, {
            accommodationName: "Large requiring two people",
            effortUnits: 3,
            estimatedMinutes: 180,
            requiredPeople: 2,
        })).toEqual({
            effortUnits: 3,
            estimatedMinutes: 180,
            requiredPeople: 2,
            sizeClass: "CUSTOM",
        });
    });

    it("uses estimatedMinutes from runtime profile when generating tasks", async () => {
        const harness = new GenerationHarness(
            { "nsc-style": accommodation("nsc-style", "NSC-style ZONA1", 80) },
            [booking("nsc-style", BookingStatus.CONFIRMED)],
            []
        );

        const result = await harness.generate([
            {
                accommodationName: "NSC-style ZONA1",
                effortUnits: 1,
                estimatedMinutes: 40,
                requiredPeople: 1,
            },
        ]);

        expect(result.tasks).toHaveLength(1);
        expect(result.tasks[0].effort.estimatedMinutes).toBe(40);
        expect(result.tasks[0].endTime).toBe("08:40");
    });
});

describe("address grouping into cleaning bundles", () => {
    it("groups three small same-address tasks into one bundle for one cleaner", () => {
        const bundles = buildCleaningBundles([
            task("APT 1", 1, 60),
            task("APT 2", 1, 60),
            task("APT 3", 1, 60),
        ], DATE);

        expect(bundles).toHaveLength(1);
        expect(bundles[0].totalEffortUnits).toBe(3);
        expect(bundles[0].requiredPeople).toBe(1);
    });

    it("groups one medium and one small same-address task into one bundle", () => {
        const bundles = buildCleaningBundles([
            task("MEDIUM", 2, 90),
            task("SMALL", 1, 60),
        ], DATE);

        expect(bundles).toHaveLength(1);
        expect(bundles[0].totalEffortUnits).toBe(3);
    });

    it("keeps one large apartment as one 3-unit bundle for one cleaner", () => {
        const bundles = buildCleaningBundles([task("LARGE", 3, 120)], DATE);

        expect(bundles).toHaveLength(1);
        expect(bundles[0].totalEffortUnits).toBe(3);
        expect(bundles[0].requiredPeople).toBe(1);
    });

    it("splits same-address demand above 3 units deterministically", () => {
        const bundles = buildCleaningBundles([
            task("APT 1", 1, 60),
            task("APT 2", 1, 60),
            task("APT 3", 1, 60),
            task("APT 4", 1, 60),
        ], DATE);

        expect(bundles).toHaveLength(2);
        expect(bundles.map(bundle => bundle.totalEffortUnits).sort()).toEqual([1, 3]);
    });
});

describe("bundle allocation", () => {
    it("assigns a fixed cleaner to a matching apartment and marks the row as fixed", async () => {
        const fixedCleaner = {
            ...cleaner(1, "Cleaner Fixed"),
            fixed_accommodations: "APT 101",
            is_fixed: 1,
        };
        const harness = new AllocationHarness([
            fixedCleaner,
            cleaner(2, "Cleaner General"),
        ]);
        const result = await harness.allocate([task("APT 101", 1, 60)]);

        expect(result.tasks[0].cleanerName).toBe("Cleaner Fixed (FIXA)");
    });

    it("matches fixed apartments by accommodation code/id as well as display name", async () => {
        const fixedCleaner = {
            ...cleaner(1, "Cleaner Fixed"),
            fixed_accommodations: "APT 101",
            is_fixed: 1,
        };
        const codedTask = {
            ...task("APT 101 ZONA1", 1, 60),
            accommodationId: "APT 101",
        };
        const harness = new AllocationHarness([
            fixedCleaner,
            cleaner(2, "Cleaner General"),
        ]);
        const result = await harness.allocate([codedTask]);

        expect(result.tasks[0].cleanerName).toBe("Cleaner Fixed (FIXA)");
    });

    it("does not treat fixed accommodations as dedicated when is_fixed is disabled", async () => {
        const notFixedCleaner = {
            ...cleaner(1, "Cleaner Listed"),
            fixed_accommodations: "APT 101",
            is_fixed: 0,
        };
        const harness = new AllocationHarness([
            notFixedCleaner,
            cleaner(2, "Cleaner General"),
        ]);
        const result = await harness.allocate([task("APT 101", 1, 60)]);

        expect(result.tasks[0].cleanerName).toBe("Cleaner Listed");
        expect(result.tasks[0].cleanerName).not.toContain("(FIXA)");
    });

    it("assigns three same-address small apartments to one cleaner when time allows", async () => {
        const harness = new AllocationHarness([cleaner(1, "Cleaner One")]);
        const result = await harness.allocate([
            task("APT 1", 1, 60),
            task("APT 2", 1, 60),
            task("APT 3", 1, 60),
        ]);

        expect(result.summary.totalBundles).toBe(1);
        expect(result.tasks.map(item => item.cleanerName)).toEqual([
            "Cleaner One",
            "Cleaner One",
            "Cleaner One",
        ]);
    });

    it("profile can force one person for a large apartment when time allows", async () => {
        const harness = new AllocationHarness([cleaner(1, "Cleaner One")]);
        const result = await harness.allocate([task("A303-like", 3, 150)]);

        expect(result.tasks).toHaveLength(1);
        expect(result.tasks[0].cleanerName).toBe("Cleaner One");
        expect(result.tasks[0].cleanerName).not.toContain("&");
    });

    it("profile can force two people for a large apartment", async () => {
        const harness = new AllocationHarness([
            cleaner(1, "Cleaner One"),
            cleaner(2, "Cleaner Two"),
        ]);
        const result = await harness.allocate([task("Large two-person", 3, 180, "STREET|PINE|100|RIO", 2)]);

        expect(result.tasks).toHaveLength(1);
        expect(result.tasks[0].cleanerName).toBe("Cleaner One & Cleaner Two");
    });

    it("mixed same-address bundle uses max requiredPeople among tasks", async () => {
        const bundles = buildCleaningBundles([
            task("SMALL", 1, 60),
            task("SPECIAL", 1, 60, "STREET|PINE|100|RIO", 2),
        ], DATE);
        expect(bundles).toHaveLength(1);
        expect(bundles[0].requiredPeople).toBe(2);

        const harness = new AllocationHarness([
            cleaner(1, "Cleaner One"),
            cleaner(2, "Cleaner Two"),
        ]);
        const result = await harness.allocate([
            task("SMALL", 1, 60),
            task("SPECIAL", 1, 60, "STREET|PINE|100|RIO", 2),
        ]);

        expect(new Set(result.tasks.map(item => item.cleanerName))).toEqual(new Set(["Cleaner One & Cleaner Two"]));
    });

    it("uses extra cleaners when real cleaners are off", async () => {
        const harness = new AllocationHarness([cleaner(1, "Cleaner One")], [1]);
        const result = await harness.allocate([task("A303-like", 3, 150)]);

        expect(result.summary.extraCleanersNeeded).toBeGreaterThan(0);
        expect(result.summary.extraCleanersByZone.ZONA1).toBeGreaterThan(0);
        expect(result.tasks[0].cleanerName).toBe("EXTRA 1");
    });

    it("does not inflate extras to the safety limit when a bundle cannot fit any deadline", async () => {
        const impossible = task("Impossible deadline", 1, 60);
        impossible.deadlineMinutes = 8 * 60 + 30;

        const harness = new AllocationHarness([cleaner(1, "Cleaner One")]);
        const result = await harness.allocate([impossible]);

        expect(result.summary.extraCleanersNeeded).toBeLessThan(20);
        expect(result.summary.warnings.length).toBeGreaterThan(0);
    });
});

describe("fallback large-apartment warnings", () => {
    it("adds a POST-summary warning when a large apartment has no explicit profile", async () => {
        const harness = new GenerationHarness(
            { "large-1": accommodation("large-1", "Large Fallback ZONA1", 100) },
            [booking("large-1", BookingStatus.CONFIRMED)],
            []
        );

        const result = await harness.generate([]);

        expect(result.summary.warnings).toContain(
            "Imóvel Large Fallback ZONA1 foi classificado como LARGE por fallback. Recomenda-se cadastrar perfil de limpeza para confirmar effortUnits, estimatedMinutes e requiredPeople."
        );
    });

    it("does not add the fallback-large warning when a profile is present", async () => {
        const harness = new GenerationHarness(
            { "large-1": accommodation("large-1", "Large Profiled ZONA1", 100) },
            [booking("large-1", BookingStatus.CONFIRMED)],
            []
        );

        const result = await harness.generate([
            {
                accommodationName: "Large Profiled ZONA1",
                effortUnits: 3,
                estimatedMinutes: 150,
                requiredPeople: 1,
            },
        ]);

        expect(result.summary.warnings.some(warning => warning.includes("foi classificado como LARGE por fallback"))).toBe(false);
    });
});

describe("owner booking classification", () => {
    it("classifies owner to owner as extension with no normal cleaning", () => {
        const requirement = classifyCleaningRequirement(
            booking("1", BookingStatus.OWNER),
            booking("1", BookingStatus.OWNER),
        );
        expect(requirement).toBe("OWNER_EXTENSION");
    });

    it("does not generate cleaning tasks for owner extension", async () => {
        const harness = new GenerationHarness(
            { "owner-1": accommodation("owner-1", "Owner Extension ZONA1", 50) },
            [booking("owner-1", BookingStatus.OWNER)],
            [booking("owner-1", BookingStatus.OWNER)]
        );

        const result = await harness.generate([]);

        expect(result.tasks).toHaveLength(0);
        expect(result.summary.totalApartments).toBe(0);
        expect(result.summary.totalBundles).toBe(0);
    });

    it("classifies owner checkout to guest checkin as required cleaning", () => {
        const requirement = classifyCleaningRequirement(
            booking("1", BookingStatus.OWNER),
            booking("1", BookingStatus.CONFIRMED),
        );
        expect(requirement).toBe("OWNER_TO_GUEST");
    });

    it("classifies guest checkout to owner checkin distinctly", () => {
        const requirement = classifyCleaningRequirement(
            booking("1", BookingStatus.CONFIRMED),
            booking("1", BookingStatus.OWNER),
        );
        expect(requirement).toBe("GUEST_TO_OWNER");
    });
});

describe("deadline time parsing", () => {
    it("uses local time from expectedArrivalTime with timezone offset, not UTC-shifted time", () => {
        const checkin = {
            ...booking("time-1", BookingStatus.CONFIRMED),
            expectedArrivalTime: "2026-04-29T15:30:00-03:00",
        };

        expect(extractCheckInTimeMinutes(checkin)).toBe(15 * 60 + 30);
        expect(getDeadlineMinutes("GUEST_TURNOVER", checkin)).toBe(14 * 60 + 30);
    });
});

describe("zone matching", () => {
    it("uses exact comma-separated tokens", () => {
        expect(cleanerCanWorkZone({ zones: "ZONA1,ZONA2" }, "ZONA1")).toBe(true);
        expect(cleanerCanWorkZone({ zones: "ZONA1,ZONA2" }, "ZONA10")).toBe(false);
    });
});

describe("export compatibility", () => {
    it("keeps the XLS fields consumed by n8n", () => {
        const report = new GenerateReport();
        const base64 = report.generateScheduleReport(DATE, [task("APT 1", 1, 60)]);
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

describe("distance helpers", () => {
    it("keeps travel distance helpers stable", () => {
        expect(haversineDistanceKm(-23.5, -46.6, -23.5, -46.6)).toBe(0);
        expect(travelMinutesByDistance(0)).toBe(5);
    });
});
