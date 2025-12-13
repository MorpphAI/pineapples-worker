import { AvantioService } from "./avantioService";
import { ScheduleRepository } from "../repositories/scheduleRepository";
import { Env } from "../types/configTypes";
import { CleaningTask } from "../types/cleanerTypes";
import { AccommodationStatus, AvantioAccommodation } from "../types/avantioTypes";
import { AvantioBooking } from "../types/avantioTypes";
import * as utils from "../utils/scheduleUtils";

export class ScheduleService {
    private avantioService: AvantioService;
    private scheduleRepo: ScheduleRepository;

    constructor(env: Env) {
        this.avantioService = new AvantioService(env);
        this.scheduleRepo = new ScheduleRepository(env.DB);
    }

    async generateDailySchedule(date: string) {

        console.log(`[ScheduleService] Iniciando geração para ${date}`);

        const { checkins, checkouts } = await this.fetchAndFilterBookings(date);

        const turnoverIds = this.identifyTurnovers(checkins, checkouts);

        const idsToClean = this.getAccommodationIdsToClean(checkouts);

        console.log(`[ScheduleService] Imóveis para limpar: ${idsToClean.size}`);

        const tasks = await this.enrichAndBuildTasks(idsToClean, checkins, checkouts, turnoverIds);

        const prioritizedTasks = this.prioritizeTasks(tasks);

        const runId = await this.scheduleRepo.saveScheduleRun(date, prioritizedTasks);

        return { runId, items: prioritizedTasks };
    }


    private async fetchAndFilterBookings(date: string) {
        const [rawCheckins, rawCheckouts] = await Promise.all([
            this.avantioService.getCheckins(date),
            this.avantioService.getCheckouts(date)
        ]);

        const checkins = rawCheckins.filter(b => utils.isValidBookingStatus(b.status));
        const checkouts = rawCheckouts.filter(b => utils.isValidBookingStatus(b.status));

        console.log(`[ScheduleService] Filtrados: ${checkins.length} Check-ins, ${checkouts.length} Check-outs`);

        return { checkins, checkouts };
    }

    private getAccommodationIdsToClean(checkouts: AvantioBooking[]): Set<string> {
        const ids = new Set<string>();
        checkouts.forEach(b => ids.add(b.accommodationId));
        return ids;
    }

    private identifyTurnovers(checkins: AvantioBooking[], checkouts: AvantioBooking[]): Set<string> {
        const checkinIds = new Set(checkins.map(b => b.accommodationId));
        const turnoverIds = new Set<string>();

        for (const booking of checkouts) {
            if (checkinIds.has(booking.accommodationId)) {
                turnoverIds.add(booking.accommodationId);
            }
        }
        return turnoverIds;
    }

    private async enrichAndBuildTasks(
        idsToClean: Set<string>,
        checkins: AvantioBooking[],
        checkouts: AvantioBooking[],
        turnoverIds: Set<string>
    ): Promise<CleaningTask[]> {

        const tasks: CleaningTask[] = [];

        const fetchAccommodations = Array.from(idsToClean).map(id => this.avantioService.getAccommodation(id));

        const accommodations = await Promise.all(fetchAccommodations);

        for (const accommodation of accommodations) {

            if (!accommodation || accommodation.status === AccommodationStatus.DISABLED) continue;

            const zone = utils.extractZoneFromAccommodationName(accommodation.name);

            if (!zone) {
                console.warn(`[ScheduleService] Imóvel ${accommodation.name} ignorado: Zona não identificada.`);
                continue;
            }

            const bookingIn = checkins.find(b => b.accommodationId === accommodation.id);

            const bookingOut = checkouts.find(b => b.accommodationId === accommodation.id);

            const isTurnover = turnoverIds.has(accommodation.id);

            const area = accommodation.area?.livingSpace?.amount || 0;

            const effort = utils.calculateCleaningEffort(area);

            const address = `${accommodation.location.address}, ${accommodation.location.number} ${accommodation.location.door || ''} - ${accommodation.location.cityName}`;

            tasks.push({
                bookingInId: bookingIn ? bookingIn.id : null,
                bookingOutId: bookingOut ? bookingOut.id : null,
                accommodationId: accommodation.id,
                accommodationName: accommodation.name,
                zone: zone,
                checkInDate: bookingIn ? bookingIn.stayDates.arrival : null,
                checkOutDate: bookingOut ? bookingOut.stayDates.departure : null,
                isTurnover: isTurnover,
                areaM2: area,
                address: address,
                effort: effort
            });
        }

        return tasks;
    }

    private prioritizeTasks(tasks: CleaningTask[]): CleaningTask[] {
        return tasks.sort((a, b) => {
            const aHasCheckin = !!a.checkInDate;
            const bHasCheckin = !!b.checkInDate;

            if (aHasCheckin && !bHasCheckin) return -1;
            if (!aHasCheckin && bHasCheckin) return 1;

            if (a.effort.teamSize !== b.effort.teamSize) {
                return b.effort.teamSize - a.effort.teamSize;
            }

            if (a.areaM2 !== b.areaM2) {
                return b.areaM2 - a.areaM2;
            }

            return a.accommodationName.localeCompare(b.accommodationName);
        });
    }
}