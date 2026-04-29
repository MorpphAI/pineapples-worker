import { ScaleRepository } from "../../../../repositories/scale/scaleRepository";
import { GenerateScheduleOptions } from "../../../../types/cleanerTypes";
import { Env } from "../../../../types/configTypes";
import { BaseScaleService } from "../BaseScaleService";

export class ScaleService extends BaseScaleService {
    private scaleRepo: ScaleRepository;

    constructor(env: Env) {
        super(env);
        this.scaleRepo = new ScaleRepository(env.DB);
    }

    async generateDailySchedule(date: string, options: GenerateScheduleOptions = {}, warnings: string[] = []) {
        this.resetWarnings(warnings);
        console.log(`[ScheduleService] Iniciando geracao para ${date}`);

        const { checkins, checkouts } = await this.fetchAndFilterBookings(date);
        const turnoverIds = this.identifyTurnovers(checkins, checkouts);
        const idsToClean = this.getAccommodationIdsToClean(checkouts, checkins);

        console.log(`[ScheduleService] Imoveis para limpar: ${idsToClean.size}`);

        const tasks = await this.enrichAndBuildTasks(
            idsToClean,
            checkins,
            checkouts,
            turnoverIds,
            options.cleaningProfiles || []
        );
        const prioritizedTasks = this.prioritizeTasks(tasks);
        const allocation = await this.allocateTasksToCleaners(prioritizedTasks, date);
        const runId = await this.scaleRepo.saveScheduleRun(date, allocation.tasks);

        return { runId, items: allocation.tasks, summary: allocation.summary };
    }
}
