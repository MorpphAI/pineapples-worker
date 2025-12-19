import { ScaleRepository } from "src/repositories/scale/scaleRepository";
import { Env } from "../../../../types/configTypes";
import { CleanerScheduleView } from "../../../../types/cleanerTypes";

export class GetScaleViewService { 
    private scaleRepo: ScaleRepository;

    constructor(env: Env) {     
        this.scaleRepo = new ScaleRepository(env.DB);
    }   


    async getCleanerDailyView(date: string): Promise<CleanerScheduleView[]> {

        const run = await this.scaleRepo.getRunByDate(date);
        
        if (!run) {
            return [];
        }

        const tasks = await this.scaleRepo.getScheduleItems(run.id);

        const groupedMap = new Map<string, CleanerScheduleView>();

        for (const task of tasks) {

            const cleanerName = task.cleanerName || "NÃO ALOCADO";

            if (!groupedMap.has(cleanerName)) {
                groupedMap.set(cleanerName, {
                    cleanerName: cleanerName,
                    tasks: []
                });
            }

            const cleanerGroup = groupedMap.get(cleanerName)!;

            cleanerGroup.tasks.push({
                timeRange: `${task.startTime || '?'} - ${task.endTime || '?'}`,
                accommodation: task.accommodationName,
                type: task.isTurnover ? "TURNOVER (Sai/Entra)" : (task.checkInDate ? "CHECK-IN" : "SAÍDA"),
                address: task.address,
                zone: task.zone
            });
        }

        const result = Array.from(groupedMap.values()).sort((a, b) => a.cleanerName.localeCompare(b.cleanerName));
        
        result.forEach(group => {
            group.tasks.sort((a, b) => a.timeRange.localeCompare(b.timeRange));
        });

        return result;
    }
}