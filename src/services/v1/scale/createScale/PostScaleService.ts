import { ScaleRepository } from "../../../../repositories/scale/scaleRepository";
import { Env } from "../../../../types/configTypes";
import { BaseScaleService } from "../BaseScaleService";

export class ScaleService extends BaseScaleService {
    private scaleRepo: ScaleRepository;

    constructor(env: Env) {
        super(env);
        this.scaleRepo = new ScaleRepository(env.DB);
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
}
