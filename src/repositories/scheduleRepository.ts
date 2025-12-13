import { D1Database } from "@cloudflare/workers-types";
import { CleaningTask } from "../types/cleanerTypes";

export class ScheduleRepository {
    private db: D1Database;

    constructor(db: D1Database) {
        this.db = db;
    }

    async saveScheduleRun(date: string, tasks: CleaningTask[]): Promise<number> {
        const runResult = await this.db.prepare(
            `INSERT INTO schedule_runs (target_date, status) VALUES (?, 'PUBLISHED') RETURNING id`
        ).bind(date).first();

        if (!runResult) throw new Error("Falha ao criar Schedule Run");
        const runId = runResult.id as number;

        if (tasks.length > 0) {
            const stmt = this.db.prepare(`
                INSERT INTO schedule_items 
                (run_id, zone, accommodation_code, is_turnover, start_time, end_time, address)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            const batch = tasks.map(t => stmt.bind(
                runId,
                t.zone,
                t.accommodationName, 
                t.isTurnover ? 1 : 0,
                t.checkInDate,  
                t.checkOutDate, 
                t.address
            ));

            await this.db.batch(batch);
        }

        return runId;
    }
}