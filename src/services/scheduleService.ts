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

        const uniqueAccommodationIds = this.getUniqueAccommodationIds(checkins, checkouts);

        const tasks = await this.enrichAndBuildTasks(uniqueAccommodationIds, checkins, checkouts, turnoverIds);

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
    
    private getUniqueAccommodationIds(checkins: AvantioBooking[], checkouts: AvantioBooking[]): Set<string> {
        const ids = new Set<string>();
        checkins.forEach(b => ids.add(b.accommodationId));
        checkouts.forEach(b => ids.add(b.accommodationId));
        return ids;
    }

    private async enrichAndBuildTasks(
        ids: Set<string>, 
        checkins: AvantioBooking[], 
        checkouts: AvantioBooking[],
        turnoverIds: Set<string>
    ): Promise<CleaningTask[]> {
        const tasks: CleaningTask[] = [];

        const fetchPromises = Array.from(ids).map(id => this.avantioService.getAccommodation(id));
        const accommodations = await Promise.all(fetchPromises);

        for (const acc of accommodations) {
            if (!acc || acc.status === AccommodationStatus.DISABLED) continue;

            const zone = utils.extractZoneFromAccommodationName(acc.name);
            if (!zone) {
                console.warn(`[ScheduleService] Imóvel ${acc.name} ignorado: Zona não identificada.`);
                continue; 
            }

            const bookingIn = checkins.find(b => b.accommodationId === acc.galleryId);
            const bookingOut = checkouts.find(b => b.accommodationId === acc.galleryId);
            const isTurnover = turnoverIds.has(acc.galleryId);

            const area = acc.area?.livingSpace?.amount || 0; 
            const effort = utils.calculateCleaningEffort(area);

            const address = `${acc.location.address}, ${acc.location.number} ${acc.location.door || ''} - ${acc.location.cityName}`;

            tasks.push({
                accommodationId: acc.galleryId,
                accommodationName: acc.name,
                zone: zone,
                checkInTime: bookingIn ? bookingIn.stayDates.arrival : null,
                checkOutTime: bookingOut ? bookingOut.stayDates.departure : null,
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
            const aHasCheckin = !!a.checkInTime;
            const bHasCheckin = !!b.checkInTime;

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