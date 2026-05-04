import { overrideRowToCleaningProfileOverride } from "../../../../domain/accommodation/accommodationCleaningProfile";
import { AccommodationCleaningOverrideRepository } from "../../../../repositories/accommodation/accommodationCleaningOverrideRepository";
import { ScaleRepository } from "../../../../repositories/scale/scaleRepository";
import { GenerateScheduleOptions } from "../../../../types/cleanerTypes";
import { Env } from "../../../../types/configTypes";
import { BaseScaleService } from "../BaseScaleService";

export class ScaleService extends BaseScaleService {
    private scaleRepo: ScaleRepository;
    private overrideRepo: AccommodationCleaningOverrideRepository;

    constructor(env: Env) {
        super(env);
        this.scaleRepo = new ScaleRepository(env.DB);
        this.overrideRepo = new AccommodationCleaningOverrideRepository(env.DB);
    }

    async generateDailySchedule(date: string, options: GenerateScheduleOptions = {}, warnings: string[] = []) {
        this.resetWarnings(warnings);
        console.log(`[ScheduleService] Iniciando geracao para ${date}`);

        const { checkins, checkouts } = await this.fetchAndFilterBookings(date);
        const turnoverIds = this.identifyTurnovers(checkins, checkouts);
        const idsToClean = this.getAccommodationIdsToClean(checkouts, checkins);

        console.log(`[ScheduleService] Imoveis para limpar: ${idsToClean.size}`);

        const cleaningProfiles = await this.resolveCleaningProfiles(options);
        const tasks = await this.enrichAndBuildTasks(
            idsToClean,
            checkins,
            checkouts,
            turnoverIds,
            cleaningProfiles
        );
        const prioritizedTasks = this.prioritizeTasks(tasks);
        const allocation = await this.allocateTasksToCleaners(prioritizedTasks, date);
        const runId = await this.scaleRepo.saveScheduleRun(date, allocation.tasks);

        return { runId, items: allocation.tasks, summary: allocation.summary };
    }

    private async resolveCleaningProfiles(options: GenerateScheduleOptions) {
        if (options.cleaningProfiles !== undefined) {
            return options.cleaningProfiles;
        }

        try {
            const overrides = await this.overrideRepo.findAllActive();
            return overrides.map(override => overrideRowToCleaningProfileOverride(
                override,
                override.accommodation_id,
            ));
        } catch (error) {
            console.warn("[ScheduleService] Falha ao carregar overrides de limpeza do D1; usando fallback do algoritmo.", error);
            this.warnings.push("Nao foi possivel carregar perfis de limpeza persistidos; usando comportamento padrao.");
            return [];
        }
    }
}
