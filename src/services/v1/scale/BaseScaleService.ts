import { AvantioApiGateway } from "../../../apiGateways/avantio/getAppointments";
import { AccommodationRepository } from "../../../repositories/accommodation/accommodationRepository";
import { CleanerRepository } from "../../../repositories/cleaner/cleanerRepository";
import { OffDayRepository } from "../../../repositories/cleaner/offDayRepository";
import { AccommodationStatus, AvantioAccommodation, AvantioBooking } from "../../../types/avantioTypes";
import { Env } from "../../../types/configTypes";
import {
    CleanerState,
    CleaningBundle,
    CleaningProfileOverride,
    CleaningTask,
    ScaleSummary,
} from "../../../types/cleanerTypes";
import * as utils from "../../../utils/scaleUtils";

type AllocationResult = {
    tasks: CleaningTask[];
    bundles: CleaningBundle[];
    summary: ScaleSummary;
};

export abstract class BaseScaleService {
    protected avantioApiGateway: AvantioApiGateway;
    protected accommodationRepo: AccommodationRepository | null;
    protected cleanerRepo: CleanerRepository;
    protected offDayRepo: OffDayRepository;
    protected readonly TRAVEL_BUFFER_MINUTES = 30;
    protected readonly EXTRA_CLEANER_LIMIT = 20;
    protected warnings: string[] = [];

    constructor(env: Env) {
        this.avantioApiGateway = new AvantioApiGateway(env);
        this.accommodationRepo = env?.DB ? new AccommodationRepository(env.DB) : null;
        this.cleanerRepo = new CleanerRepository(env.DB);
        this.offDayRepo = new OffDayRepository(env.DB);
    }

    protected resetWarnings(extraWarnings: string[] = []) {
        this.warnings = [...extraWarnings];
    }

    protected async fetchAndFilterBookings(date: string): Promise<{ checkins: AvantioBooking[], checkouts: AvantioBooking[] }> {
        const [rawCheckins, rawCheckouts] = await Promise.all([
            this.avantioApiGateway.getCheckins(date),
            this.avantioApiGateway.getCheckouts(date)
        ]);

        const checkins = rawCheckins.filter(b => utils.isValidBookingStatus(b.status));
        const checkouts = rawCheckouts.filter(b => utils.isValidBookingStatus(b.status));

        console.log(`[ScaleService] Filtrados: ${checkins.length} Check-ins, ${checkouts.length} Check-outs`);
        return { checkins, checkouts };
    }

    protected identifyTurnovers(checkins: AvantioBooking[], checkouts: AvantioBooking[]): Set<string> {
        const turnoverIds = new Set<string>();

        for (const bookingOut of checkouts) {
            const bookingIn = checkins.find(b => b.accommodationId === bookingOut.accommodationId);
            const requirement = utils.classifyCleaningRequirement(bookingOut, bookingIn);
            if (utils.isSameDayTurnover(requirement)) {
                turnoverIds.add(bookingOut.accommodationId);
            }
        }
        return turnoverIds;
    }

    protected getAccommodationIdsToClean(checkouts: AvantioBooking[], checkins: AvantioBooking[] = []): Set<string> {
        const ids = new Set<string>();
        checkouts.forEach(bookingOut => {
            const bookingIn = checkins.find(b => b.accommodationId === bookingOut.accommodationId);
            const requirement = utils.classifyCleaningRequirement(bookingOut, bookingIn);
            if (utils.cleaningIsRequired(requirement)) {
                ids.add(bookingOut.accommodationId);
            }
        });
        return ids;
    }

    protected async enrichAndBuildTasks(
        idsToClean: Set<string>,
        checkins: AvantioBooking[],
        checkouts: AvantioBooking[],
        turnoverIds: Set<string>,
        cleaningProfiles: CleaningProfileOverride[] = []
    ): Promise<CleaningTask[]> {
        const tasks: CleaningTask[] = [];

        const fetchAccommodations = Array.from(idsToClean).map(id => this.avantioApiGateway.getAccommodation(id));
        const accommodations = await Promise.all(fetchAccommodations);
        const knownAccommodations = accommodations.filter((item): item is AvantioAccommodation => !!item);

        if (this.accommodationRepo && knownAccommodations.length > 0) {
            try {
                await this.accommodationRepo.upsertMany(knownAccommodations);
            } catch (error) {
                console.warn("[ScaleService] Falha ao atualizar tabela de apartamentos; seguindo com a escala.", error);
            }
        }

        for (const accommodation of accommodations) {
            if (!accommodation || accommodation.status === AccommodationStatus.DISABLED) continue;

            const bookingIn = checkins.find(b => b.accommodationId === accommodation.id);
            const bookingOut = checkouts.find(b => b.accommodationId === accommodation.id);
            const cleaningRequirement = utils.classifyCleaningRequirement(bookingOut, bookingIn);
            if (!utils.cleaningIsRequired(cleaningRequirement)) continue;

            const profile = utils.findCleaningProfile(cleaningProfiles, accommodation.id, accommodation.name);
            const zone = profile?.zoneOverride || utils.extractZoneFromAccommodationName(accommodation.name);

            if (!zone) {
                this.warnings.push(`Imovel ${accommodation.name} ignorado: zona nao identificada.`);
                continue;
            }

            let stayDuration: number | null = null;
            if (bookingOut?.stayDates?.arrival && bookingOut?.stayDates?.departure) {
                const arrival = new Date(bookingOut.stayDates.arrival);
                const departure = new Date(bookingOut.stayDates.departure);
                const diffMs = departure.getTime() - arrival.getTime();
                stayDuration = Math.round(diffMs / (1000 * 60 * 60 * 24));
            }

            const rawCoords = accommodation.location.coordinates;
            const rawLat = rawCoords?.lat != null ? parseFloat(rawCoords.lat) : null;
            const rawLon = rawCoords?.lon != null ? parseFloat(rawCoords.lon) : null;
            const latitude = rawLat != null && !isNaN(rawLat) ? rawLat : null;
            const longitude = rawLon != null && !isNaN(rawLon) ? rawLon : null;

            const area = accommodation.area?.livingSpace?.amount || 0;
            if (!accommodation.area?.livingSpace?.amount) {
                this.warnings.push(`Imovel sem area cadastrada: ${accommodation.name} (${accommodation.id}).`);
            }

            const fallbackEffort = utils.calculateCleaningEffort(area, stayDuration);
            if (!profile && fallbackEffort.sizeClass === "LARGE") {
                this.warnings.push(
                    `Imóvel ${accommodation.name} foi classificado como LARGE por fallback. ` +
                    "Recomenda-se cadastrar perfil de limpeza para confirmar effortUnits, estimatedMinutes e requiredPeople."
                );
            }
            const effort = utils.applyCleaningProfile(fallbackEffort, profile);
            const addressGroupKey = profile?.addressGroupKeyOverride || utils.buildAddressGroupKey(accommodation);
            const address = `${accommodation.location.addrType === "AVENUE" ? "Av. " : "Rua "}${accommodation.location.address}, No ${accommodation.location.number} AP ${accommodation.location.door || ""} - ${accommodation.location.cityName}`;
            const deadlineMinutes = utils.getDeadlineMinutes(cleaningRequirement, bookingIn);

            if (bookingIn && utils.extractCheckInTimeMinutes(bookingIn) === null && utils.isSameDayTurnover(cleaningRequirement)) {
                const warning = "Avantio nao retornou horario de check-in/check-out no payload atual; usando deadlines fallback.";
                if (!this.warnings.includes(warning)) this.warnings.push(warning);
            }

            tasks.push({
                bookingInId: bookingIn ? bookingIn.id : null,
                bookingOutId: bookingOut ? bookingOut.id : null,
                accommodationId: accommodation.id,
                accommodationName: accommodation.name,
                zone,
                checkInDate: bookingIn ? bookingIn.stayDates.arrival : null,
                checkOutDate: bookingOut ? bookingOut.stayDates.departure : null,
                isTurnover: turnoverIds.has(accommodation.id),
                cleaningRequirement,
                stayDuration,
                areaM2: area,
                address,
                addressGroupKey,
                effort,
                priorityScore: 0,
                deadlineMinutes,
                latitude,
                longitude,
            });
        }

        return tasks;
    }

    protected prioritizeTasks(tasks: CleaningTask[]): CleaningTask[] {
        const scoredTasks = tasks.map(task => {
            let score = 0;

            if (task.cleaningRequirement === "GUEST_TURNOVER" || task.cleaningRequirement === "OWNER_TO_GUEST") score += 1000;
            if (task.cleaningRequirement === "GUEST_TO_OWNER") score += 800;
            if (task.isTurnover) score += 500;
            if (task.checkInDate) score += 300;
            if (task.cleaningRequirement === "OWNER_CHECKOUT") score -= 100;
            if (task.stayDuration != null && task.stayDuration > 7) score += 100;
            if (task.stayDuration != null && task.stayDuration > 4) score += 200;
            score += task.effort.effortUnits * 100;
            score += Math.floor(task.areaM2 / 10) * 10;

            return { ...task, priorityScore: score };
        });

        return scoredTasks.sort((a, b) => {
            const diff = (b.priorityScore ?? 0) - (a.priorityScore ?? 0);
            if (diff !== 0) return diff;
            return a.accommodationName.localeCompare(b.accommodationName);
        });
    }

    protected buildCleaningBundles(tasks: CleaningTask[], date: string): CleaningBundle[] {
        return utils.buildCleaningBundles(tasks, date);
    }

    private getEffectiveStart(
        cleaner: CleanerState,
        isFirstTask: boolean,
        travelBuffer?: number
    ): number {
        const LUNCH_BREAK = 60;
        const buffer = travelBuffer ?? this.TRAVEL_BUFFER_MINUTES;
        if (isFirstTask) return cleaner.currentAvailableMinutes;
        if (cleaner.lunchBreakTaken) return cleaner.currentAvailableMinutes + buffer;
        return cleaner.currentAvailableMinutes + LUNCH_BREAK;
    }

    private getTravelBuffer(cleaner: CleanerState, bundle: CleaningBundle): number {
        if (
            cleaner.lastLatitude != null &&
            cleaner.lastLongitude != null &&
            bundle.latitude != null &&
            bundle.longitude != null
        ) {
            const distKm = utils.haversineDistanceKm(
                cleaner.lastLatitude,
                cleaner.lastLongitude,
                bundle.latitude,
                bundle.longitude
            );
            return utils.travelMinutesByDistance(distKm);
        }
        return this.TRAVEL_BUFFER_MINUTES;
    }

    private cleanerCanFitBundle(cleaner: CleanerState, bundle: CleaningBundle): boolean {
        if (!utils.cleanerCanWorkZone(cleaner, bundle.zone)) return false;

        const buf = this.getTravelBuffer(cleaner, bundle);
        const effectiveStartTime = this.getEffectiveStart(cleaner, cleaner.tasksCount === 0, buf);
        const taskEnd = effectiveStartTime + bundle.totalMinutes;
        const effectiveLimit = Math.min(cleaner.shiftEndMinutes, bundle.deadlineMinutes);
        return taskEnd <= effectiveLimit;
    }

    private assignBundle(bundle: CleaningBundle, cleaners: CleanerState[], fixedSuffix = false): CleaningBundle {
        const startMinutes = Math.max(...cleaners.map(cleaner => {
            const buf = this.getTravelBuffer(cleaner, bundle);
            return this.getEffectiveStart(cleaner, cleaner.tasksCount === 0, buf);
        }));
        const endMinutes = startMinutes + bundle.totalMinutes;

        cleaners.forEach(cleaner => {
            if (!cleaner.lunchBreakTaken) {
                const pauseUsed = startMinutes - cleaner.currentAvailableMinutes;
                if (pauseUsed >= 60) cleaner.lunchBreakTaken = true;
            }
            cleaner.currentAvailableMinutes = endMinutes;
            cleaner.tasksCount++;
            cleaner.lastLatitude = bundle.latitude ?? null;
            cleaner.lastLongitude = bundle.longitude ?? null;
        });

        const cleanerName = cleaners.map(c => c.name).join(" & ") + (fixedSuffix ? " (FIXA)" : "");
        return {
            ...bundle,
            cleanerName,
            startTime: utils.minutesToTime(startMinutes),
            endTime: utils.minutesToTime(endMinutes),
        };
    }

    private findDedicatedCleaner(bundle: CleaningBundle, fixedCleaners: CleanerState[]): CleanerState | null {
        return fixedCleaners.find(cleaner => {
            if (!cleaner.fixed_accommodations) return false;
            const fixedList = cleaner.fixed_accommodations
                .split(",")
                .map(value => utils.normalizeKey(value))
                .filter(Boolean);
            return bundle.tasks.some(task =>
                fixedList.includes(utils.normalizeKey(task.accommodationName)) ||
                fixedList.includes(utils.normalizeKey(task.accommodationId))
            );
        }) || null;
    }

    private allocateBundlePass(
        bundles: CleaningBundle[],
        fixedCleaners: CleanerState[],
        generalCleaners: CleanerState[]
    ): { allocated: CleaningBundle[]; unallocated: CleaningBundle[] } {
        const allocated: CleaningBundle[] = [];
        const unallocated: CleaningBundle[] = [];

        for (const bundle of bundles) {
            const dedicatedCleaner = this.findDedicatedCleaner(bundle, fixedCleaners);
            if (dedicatedCleaner) {
                if (bundle.requiredPeople === 1 && this.cleanerCanFitBundle(dedicatedCleaner, bundle)) {
                    allocated.push(this.assignBundle(bundle, [dedicatedCleaner], true));
                } else {
                    unallocated.push(bundle);
                }
                continue;
            }

            const candidates = generalCleaners
                .filter(c => this.cleanerCanFitBundle(c, bundle))
                .sort((a, b) => {
                    const startA = this.getEffectiveStart(a, a.tasksCount === 0, this.getTravelBuffer(a, bundle));
                    const startB = this.getEffectiveStart(b, b.tasksCount === 0, this.getTravelBuffer(b, bundle));
                    return startA - startB;
                });

            if (candidates.length >= bundle.requiredPeople) {
                allocated.push(this.assignBundle(bundle, candidates.slice(0, bundle.requiredPeople)));
            } else {
                unallocated.push(bundle);
            }
        }

        return { allocated, unallocated };
    }

    private createVirtualCleaner(id: number, zone: string): CleanerState {
        return {
            id: -id,
            name: `EXTRA ${id}`,
            zones: zone,
            shift_start: "08:00",
            shift_end: "18:00",
            is_active: 1,
            created_at: new Date().toISOString(),
            fixed_accommodations: null,
            is_fixed: 0,
            currentAvailableMinutes: utils.timeToMinutes("08:00"),
            shiftEndMinutes: utils.timeToMinutes("17:00"),
            tasksCount: 0,
            lunchBreakTaken: false,
            lastLatitude: null,
            lastLongitude: null,
            isVirtual: true,
        };
    }

    private expandBundlesToTasks(bundles: CleaningBundle[]): CleaningTask[] {
        const rows: CleaningTask[] = [];

        for (const bundle of bundles) {
            let cursor = bundle.startTime && bundle.startTime !== "--:--" ? utils.timeToMinutes(bundle.startTime) : null;
            for (const task of bundle.tasks) {
                const start = cursor;
                const end = start != null ? start + task.effort.estimatedMinutes : null;
                rows.push({
                    ...task,
                    cleanerName: bundle.cleanerName || "SEM ALOCACAO",
                    startTime: start != null ? utils.minutesToTime(start) : "--:--",
                    endTime: end != null ? utils.minutesToTime(end) : "--:--",
                });
                if (cursor != null) cursor = end;
            }
        }

        return rows;
    }

    protected async allocateTasksToCleaners(tasks: CleaningTask[], date: string): Promise<AllocationResult> {
        const bundles = this.buildCleaningBundles(tasks, date);
        const activeCleaners = await this.cleanerRepo.findAllActive();
        const cleanersOffIds = await this.offDayRepo.getCleanersOffByDate(date);
        const availableCleaners = activeCleaners.filter(c => !cleanersOffIds.includes(c.id));

        if (!activeCleaners.length) this.warnings.push("Nenhuma faxineira ativa encontrada.");
        if (activeCleaners.length > 0 && availableCleaners.length === 0) this.warnings.push("Toda a equipe esta de folga hoje.");

        const LUNCH_BREAK_MINUTES = 60;
        const cleanersState: CleanerState[] = availableCleaners.map(c => ({
            ...c,
            currentAvailableMinutes: utils.timeToMinutes(c.shift_start),
            shiftEndMinutes: utils.timeToMinutes(c.shift_end) - LUNCH_BREAK_MINUTES,
            tasksCount: 0,
            lunchBreakTaken: false,
            lastLatitude: null,
            lastLongitude: null,
        }));

        const fixedCleaners = cleanersState.filter(c => !!c.is_fixed);
        const generalCleaners = cleanersState.filter(c => !c.is_fixed);
        const extraCleanersByZone: Record<string, number> = {};

        let allocated: CleaningBundle[] = [];
        let unallocated = bundles;
        let pass = this.allocateBundlePass(unallocated, fixedCleaners, generalCleaners);
        allocated = allocated.concat(pass.allocated);
        unallocated = pass.unallocated;

        let extraCount = 0;
        while (unallocated.length > 0 && extraCount < this.EXTRA_CLEANER_LIMIT) {
            const zone = unallocated[0].zone;
            const nextExtraNumber = extraCount + 1;
            generalCleaners.push(this.createVirtualCleaner(nextExtraNumber, zone));

            pass = this.allocateBundlePass(unallocated, [], generalCleaners);

            if (pass.allocated.length === 0) {
                generalCleaners.pop();
                this.warnings.push(`Nenhuma limpeza adicional coube ao adicionar EXTRA ${nextExtraNumber} para ${zone}; verifique deadlines e duracao.`);
                break;
            }

            extraCount = nextExtraNumber;
            extraCleanersByZone[zone] = (extraCleanersByZone[zone] || 0) + 1;
            allocated = allocated.concat(pass.allocated);
            unallocated = pass.unallocated;
        }

        if (unallocated.length > 0) {
            this.warnings.push(`${unallocated.length} pacote(s) ficaram sem alocacao mesmo apos extras.`);
        }

        const failed = unallocated.map(bundle => ({
            ...bundle,
            cleanerName: "SEM ALOCACAO",
            startTime: "--:--",
            endTime: "--:--",
        }));
        const finalBundles = allocated.concat(failed);

        const summary: ScaleSummary = {
            totalApartments: bundles.reduce((sum, bundle) => sum + bundle.tasks.length, 0),
            totalBundles: bundles.length,
            availableCleaners: availableCleaners.length,
            cleanersOff: cleanersOffIds.length,
            extraCleanersNeeded: extraCount,
            extraCleanersByZone,
            unallocatedCount: unallocated.length,
            warnings: this.warnings,
        };

        return {
            tasks: this.expandBundlesToTasks(finalBundles),
            bundles: finalBundles,
            summary,
        };
    }
}
