import { Env } from "../../../../types/configTypes";
import { BaseScaleService } from "../../scale/BaseScaleService";

export class GetPriorityWithCleanerService extends BaseScaleService {
    constructor(env: Env) {
        super(env);
    }

    async generatePriority(date: string) {
        console.log(`[GetPriorityWithCleanerService] Iniciando geração para ${date}`);

        const { checkins, checkouts } = await this.fetchAndFilterBookings(date);
        const turnoverIds = this.identifyTurnovers(checkins, checkouts);
        const idsToClean = this.getAccommodationIdsToClean(checkouts);

        console.log(`[GetPriorityWithCleanerService] Imóveis para limpar: ${idsToClean.size}`);

        const tasks = await this.enrichAndBuildTasks(idsToClean, checkins, checkouts, turnoverIds);
        const prioritizedTasks = this.prioritizeTasks(tasks);
        const allocatedTasks = await this.allocateTasksToCleaners(prioritizedTasks, date);

        return { items: allocatedTasks };
    }
}
