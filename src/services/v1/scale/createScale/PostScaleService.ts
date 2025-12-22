import { AvantioService } from "../../avantio/avantioService";
import { ScaleRepository } from "../../../../repositories/scale/scaleRepository";
import { OffDayRepository } from "../../../../repositories/cleaner/offDayRepository";
import { CleanerRepository } from "../../../../repositories/cleaner/cleanerRepository";
import { Env } from "../../../../types/configTypes";
import { CleaningTask, CleanerState } from "../../../../types/cleanerTypes";
import { AccommodationStatus, AvantioAccommodation } from "../../../../types/avantioTypes";
import { AvantioBooking } from "../../../../types/avantioTypes";
import * as utils from "../../../../utils/scaleUtils";

export class ScaleService {
    private avantioService: AvantioService;
    private scaleRepo: ScaleRepository;
    private cleanerRepo: CleanerRepository;
    private offDayRepo: OffDayRepository; 
    private readonly TRAVEL_BUFFER_MINUTES = 30;


    constructor(env: Env) {
        this.avantioService = new AvantioService(env);
        this.scaleRepo = new ScaleRepository(env.DB);
        this.cleanerRepo = new CleanerRepository(env.DB);
        this.offDayRepo = new OffDayRepository(env.DB);
    }

    async generateDailySchedule(date: string) {

        console.log(`[ScheduleService] Iniciando geração para ${date}`);

        const { checkins, checkouts } = await this.fetchAndFilterBookings(date);

        const turnoverIds = this.identifyTurnovers(checkins, checkouts);

        const idsToClean = this.getAccommodationIdsToClean(checkouts);

        console.log(`[ScheduleService] Imóveis para limpar: ${idsToClean.size}`);

        const tasks = await this.enrichAndBuildTasks(idsToClean, checkins, checkouts, turnoverIds);

        const prioritizedTasks = this.prioritizeTasks(tasks);

        const allocatedTasks = await this.allocateTasksToCleaners(prioritizedTasks, date);

        const runId = await this.scaleRepo.saveScheduleRun(date, allocatedTasks);

        return { runId, items: allocatedTasks };
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

            const address = `${accommodation.location.addrType === "AVENUE" ? "Av. " : "Rua "}${accommodation.location.address}, Nº ${accommodation.location.number} AP ${accommodation.location.door || ''} - ${accommodation.location.cityName}`;

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

     private async allocateTasksToCleaners(tasks: CleaningTask[], date: string): Promise<CleaningTask[]> {
        const activeCleaners = await this.cleanerRepo.findAllActive();
        
        if (!activeCleaners.length) {
            console.warn("ALERTA: Nenhuma faxineira ativa encontrada!");
            return tasks; 
        }

        const cleanersOffIds = await this.offDayRepo.getCleanersOffByDate(date);
        const availableCleaners = activeCleaners.filter(c => !cleanersOffIds.includes(c.id));
        
        console.log(`[Alocação] Total Ativas: ${activeCleaners.length} | De Folga: ${cleanersOffIds.length} | Disponíveis: ${availableCleaners.length}`);

        if (availableCleaners.length === 0) {
            console.warn("ALERTA CRÍTICO: Toda a equipe está de folga hoje!");
            return tasks;
        }

        const cleanersState: CleanerState[] = availableCleaners.map(c => ({
            ...c,
            currentAvailableMinutes: utils.timeToMinutes(c.shift_start),
            shiftEndMinutes: utils.timeToMinutes(c.shift_end),
            tasksCount: 0
        }));

        const fixedCleaners = cleanersState.filter(c => !!c.is_fixed);
        const generalCleaners = cleanersState.filter(c => !c.is_fixed);

        console.log(`[Alocação] Grupos: ${fixedCleaners.length} Fixas | ${generalCleaners.length} Gerais`);

        const finalTaskList: CleaningTask[] = [];

        for (const task of tasks) {
            let taskHandled = false;

            const dedicatedCleaner = fixedCleaners.find(c => {
                if (!c.fixed_accommodations) return false;
                const fixedList = c.fixed_accommodations.toUpperCase();
                const accName = task.accommodationName.toUpperCase();
                return fixedList.includes(accName);
            });

            if (dedicatedCleaner) {
                console.log(`    [!] Imóvel Fixo: ${task.accommodationName} -> ${dedicatedCleaner.name}`);
                
                const duration = task.effort.estimatedMinutes;
                const travelBuffer = dedicatedCleaner.tasksCount > 0 ? this.TRAVEL_BUFFER_MINUTES : 0;
                const startTime = dedicatedCleaner.currentAvailableMinutes + travelBuffer;
                
                if ((startTime + duration) <= dedicatedCleaner.shiftEndMinutes) {
                    const assignedTask = { ...task };
                    assignedTask.cleanerName = dedicatedCleaner.name + " (FIXA)";
                    assignedTask.startTime = utils.minutesToTime(startTime);
                    assignedTask.endTime = utils.minutesToTime(startTime + duration);
                    
                    dedicatedCleaner.currentAvailableMinutes = startTime + duration;
                    dedicatedCleaner.tasksCount++;
                    
                    finalTaskList.push(assignedTask);
                    taskHandled = true;
                } else {
                    console.warn(`    [X] Fixa ${dedicatedCleaner.name} sem horário.`);
                    const failedTask = { ...task };
                    failedTask.cleanerName = "SEM HORÁRIO (FIXA)";
                    finalTaskList.push(failedTask);
                    taskHandled = true;
                }
            }

            if (!taskHandled) {
                (task as any)._pending = true;
            }
        }

        for (const task of tasks) {
            if (!(task as any)._pending) continue;

            const requiredPeople = task.effort.teamSize;
            const duration = task.effort.estimatedMinutes;

            let candidates = generalCleaners.filter(c => {
                const cZone = c.zones.toUpperCase().replace(/\s/g, '');
                const tZone = task.zone.toUpperCase().replace(/\s/g, '');
                const zoneMatch = cZone.includes(tZone);
                
                if (!zoneMatch) return false;

                const travelBuffer = c.tasksCount > 0 ? this.TRAVEL_BUFFER_MINUTES : 0;
                const effectiveStartTime = c.currentAvailableMinutes + travelBuffer;
                return (effectiveStartTime + duration) <= c.shiftEndMinutes;
            });

            candidates.sort((a, b) => {
                const startA = a.currentAvailableMinutes + (a.tasksCount > 0 ? this.TRAVEL_BUFFER_MINUTES : 0);
                const startB = b.currentAvailableMinutes + (b.tasksCount > 0 ? this.TRAVEL_BUFFER_MINUTES : 0);
                return startA - startB;
            });

            if (candidates.length >= requiredPeople) {
                const selectedTeam = candidates.slice(0, requiredPeople);
                
                console.log(`    [V] Alocando ${task.accommodationName} para: ${selectedTeam.map(c => c.name).join(', ')}`);

                selectedTeam.forEach(cleaner => {
                    const travelBuffer = cleaner.tasksCount > 0 ? this.TRAVEL_BUFFER_MINUTES : 0;
                    const myStartTime = cleaner.currentAvailableMinutes + travelBuffer;
                    const myEndTime = myStartTime + duration;

                    const assignedTask = { ...task };
                    assignedTask.cleanerName = cleaner.name;
                    assignedTask.startTime = utils.minutesToTime(myStartTime);
                    assignedTask.endTime = utils.minutesToTime(myEndTime);

                    cleaner.currentAvailableMinutes = myEndTime;
                    cleaner.tasksCount++;

                    finalTaskList.push(assignedTask);
                });

            } else {
                console.warn(`    [!] Falha Geral: Tarefa ${task.accommodationName} (${task.zone}) - Candidatos: ${candidates.length}/${requiredPeople}`);
                const failedTask = { ...task };
                failedTask.cleanerName = "SEM ALOCACAO";
                failedTask.startTime = "--:--";
                failedTask.endTime = "--:--";
                finalTaskList.push(failedTask);
            }
        }

        return finalTaskList;
    }
}