import { Env } from "../../../../types/configTypes";
import { BaseScaleService } from "../../scale/BaseScaleService";

export class GetPriorityService extends BaseScaleService {
    constructor(env: Env) {
        super(env);
    }

    async generatePriority(date: string) {
        console.log(`[GetPriorityService] Iniciando geração para ${date}`);

        const { checkins, checkouts } = await this.fetchAndFilterBookings(date);
        const turnoverIds = this.identifyTurnovers(checkins, checkouts);
        const idsToClean = this.getAccommodationIdsToClean(checkouts, checkins);

        console.log(`[GetPriorityService] Imóveis para limpar: ${idsToClean.size}`);

        const tasks = await this.enrichAndBuildTasks(idsToClean, checkins, checkouts, turnoverIds);
        const prioritizedTasks = this.prioritizeTasks(tasks);

        return { items: prioritizedTasks };
    }
}
