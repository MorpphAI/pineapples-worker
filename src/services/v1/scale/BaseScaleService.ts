import { AvantioApiGateway } from "../../../apiGateways/avantio/getAppointments";
import { CleanerRepository } from "../../../repositories/cleaner/cleanerRepository";
import { OffDayRepository } from "../../../repositories/cleaner/offDayRepository";
import { Env } from "../../../types/configTypes";
import { CleaningTask, CleanerState } from "../../../types/cleanerTypes";
import { AccommodationStatus } from "../../../types/avantioTypes";
import { AvantioBooking } from "../../../types/avantioTypes";
import * as utils from "../../../utils/scaleUtils";

export abstract class BaseScaleService {
    protected avantioApiGateway: AvantioApiGateway;
    protected cleanerRepo: CleanerRepository;
    protected offDayRepo: OffDayRepository;
    protected readonly TRAVEL_BUFFER_MINUTES = 30;

    constructor(env: Env) {
        this.avantioApiGateway = new AvantioApiGateway(env);
        this.cleanerRepo = new CleanerRepository(env.DB);
        this.offDayRepo = new OffDayRepository(env.DB);
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
        const checkinIds = new Set(checkins.map(b => b.accommodationId));
        const turnoverIds = new Set<string>();

        for (const booking of checkouts) {
            if (checkinIds.has(booking.accommodationId)) {
                turnoverIds.add(booking.accommodationId);
            }
        }
        return turnoverIds;
    }

    protected getAccommodationIdsToClean(checkouts: AvantioBooking[]): Set<string> {
        const ids = new Set<string>();
        checkouts.forEach(b => ids.add(b.accommodationId));
        return ids;
    }

    protected async enrichAndBuildTasks(
        idsToClean: Set<string>,
        checkins: AvantioBooking[],
        checkouts: AvantioBooking[],
        turnoverIds: Set<string>
    ): Promise<CleaningTask[]> {
        const tasks: CleaningTask[] = [];

        const fetchAccommodations = Array.from(idsToClean).map(id => this.avantioApiGateway.getAccommodation(id));
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
            let stayDuration: number | null = null;
            if (bookingOut?.stayDates?.arrival && bookingOut?.stayDates?.departure) {
                const arrival = new Date(bookingOut.stayDates.arrival);
                const departure = new Date(bookingOut.stayDates.departure);
                const diffMs = departure.getTime() - arrival.getTime();
                stayDuration = Math.round(diffMs / (1000 * 60 * 60 * 24));
            }
            const area = accommodation.area?.livingSpace?.amount || 0;
            if (!accommodation.area?.livingSpace?.amount) {
                console.warn(
                    `[ALERTA METRAGEM] Imóvel sem área cadastrada: "${accommodation.name}" (ID: ${accommodation.id}). ` +
                    `Alocando na faixa < 40m² (1 pessoa, 60 min). Verifique o cadastro na Avantio.`
                );
            }
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
                stayDuration: stayDuration,
                areaM2: area,
                address: address,
                effort: effort
            });
        }

        return tasks;
    }

    protected prioritizeTasks(tasks: CleaningTask[]): CleaningTask[] {
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

    private getTaskDeadline(task: CleaningTask): number {
        const OUTIN_DEADLINE = 15 * 60;
        const CHECKOUT_DEADLINE = 17 * 60 + 50;
        return task.isTurnover ? OUTIN_DEADLINE : CHECKOUT_DEADLINE;
    }

    private getEffectiveStart(cleaner: CleanerState, isFirstTask: boolean): number {
        const LUNCH_BREAK = 60;
        if (isFirstTask) return cleaner.currentAvailableMinutes;
        if (cleaner.lunchBreakTaken) return cleaner.currentAvailableMinutes + this.TRAVEL_BUFFER_MINUTES;
        return cleaner.currentAvailableMinutes + LUNCH_BREAK;
    }

    protected async allocateTasksToCleaners(tasks: CleaningTask[], date: string): Promise<CleaningTask[]> {
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

        const LUNCH_BREAK_MINUTES = 60;
        const cleanersState: CleanerState[] = availableCleaners.map(c => ({
            ...c,
            currentAvailableMinutes: utils.timeToMinutes(c.shift_start),
            shiftEndMinutes: utils.timeToMinutes(c.shift_end) - LUNCH_BREAK_MINUTES,
            tasksCount: 0,
            lunchBreakTaken: false
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
                const startTime = this.getEffectiveStart(dedicatedCleaner, dedicatedCleaner.tasksCount === 0);

                const taskDeadline = this.getTaskDeadline(task);
                const effectiveLimit = Math.min(dedicatedCleaner.shiftEndMinutes, taskDeadline);
                if ((startTime + duration) <= effectiveLimit) {
                    const assignedTask = { ...task };
                    assignedTask.cleanerName = dedicatedCleaner.name + " (FIXA)";
                    assignedTask.startTime = utils.minutesToTime(startTime);
                    assignedTask.endTime = utils.minutesToTime(startTime + duration);

                    if (!dedicatedCleaner.lunchBreakTaken) {
                        const pauseUsed = startTime - dedicatedCleaner.currentAvailableMinutes;
                        if (pauseUsed >= 60) dedicatedCleaner.lunchBreakTaken = true;
                    }
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

                const effectiveStartTime = this.getEffectiveStart(c, c.tasksCount === 0);
                const taskEnd = effectiveStartTime + duration;

                const taskDeadline = this.getTaskDeadline(task);
                const effectiveLimit = Math.min(c.shiftEndMinutes, taskDeadline);
                if (taskEnd > effectiveLimit) return false;
                return true;
            });

            candidates.sort((a, b) => {
                const startA = this.getEffectiveStart(a, a.tasksCount === 0);
                const startB = this.getEffectiveStart(b, b.tasksCount === 0);
                return startA - startB;
            });

            if (candidates.length >= requiredPeople) {
                const selectedTeam = candidates.slice(0, requiredPeople);

                console.log(`    [V] Alocando ${task.accommodationName} para: ${selectedTeam.map(c => c.name).join(', ')}`);

                const startMinutes = Math.max(...selectedTeam.map(c => this.getEffectiveStart(c, c.tasksCount === 0)));
                const endMinutes = startMinutes + duration;

                const assignedTask = { ...task };
                assignedTask.cleanerName = selectedTeam.map(c => c.name).join(" & ");
                assignedTask.startTime = utils.minutesToTime(startMinutes);
                assignedTask.endTime = utils.minutesToTime(endMinutes);

                selectedTeam.forEach(cleaner => {
                    if (!cleaner.lunchBreakTaken) {
                        const pauseUsed = startMinutes - cleaner.currentAvailableMinutes;
                        if (pauseUsed >= 60) cleaner.lunchBreakTaken = true;
                    }
                    cleaner.currentAvailableMinutes = endMinutes;
                    cleaner.tasksCount++;
                });

                finalTaskList.push(assignedTask);

            } else {
                const deadline = utils.minutesToTime(this.getTaskDeadline(task));
                console.warn(`    [!] Falha Geral: ${task.accommodationName} (${task.zone}) - deadline ${deadline} - Candidatos: ${candidates.length}/${requiredPeople}`);
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
