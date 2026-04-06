import { CleanerRepository } from "../../../../repositories/cleaner/cleanerRepository";
import { ScaleRepository } from "../../../../repositories/scale/scaleRepository";
import { Env } from "../../../../types/configTypes";

export interface CleanerDaySchedule {
    cleanerId: number;
    cleanerName: string;
    date: string;
    tasks: {
        timeRange: string;
        accommodation: string;
        type: string;
        address: string;
        zone: string;
        stayDuration: number | null;
    }[];
}

export class GetCleanerScheduleService {
    private cleanerRepo: CleanerRepository;
    private scaleRepo: ScaleRepository;

    constructor(env: Env) {
        this.cleanerRepo = new CleanerRepository(env.DB);
        this.scaleRepo = new ScaleRepository(env.DB);
    }

    async getSchedule(cleanerId: number, date: string): Promise<CleanerDaySchedule | null> {
        const cleaner = await this.cleanerRepo.findById(cleanerId);
        if (!cleaner) return null;

        const run = await this.scaleRepo.getRunByDate(date);
        if (!run) {
            return {
                cleanerId: cleaner.id,
                cleanerName: cleaner.name,
                date,
                tasks: [],
            };
        }

        const items = await this.scaleRepo.getItemsByCleanerName(run.id, cleaner.name);

        return {
            cleanerId: cleaner.id,
            cleanerName: cleaner.name,
            date,
            tasks: items.map(t => ({
                timeRange: `${t.startTime || "?"} - ${t.endTime || "?"}`,
                accommodation: t.accommodationName,
                type: t.isTurnover ? "TURNOVER (Sai/Entra)" : (t.checkInDate ? "CHECK-IN" : "SAÍDA"),
                address: t.address,
                zone: t.zone,
                stayDuration: t.stayDuration,
            })),
        };
    }
}
