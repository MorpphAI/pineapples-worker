import { D1Database } from "@cloudflare/workers-types";
import { CleaningTask } from "../../types/cleanerTypes";

export class ScaleRepository {
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
                (run_id, zone, accommodation_code, accommodation_id, is_turnover, cleaner_name, start_time, end_time, address, stay_duration)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const batch = tasks.map(t => stmt.bind(
                runId,
                t.zone,
                t.accommodationName,
                t.accommodationId || null,
                t.isTurnover ? 1 : 0,
                t.cleanerName || "NÃO ALOCADO",
                t.startTime || null,
                t.endTime || null,
                t.address,
                t.stayDuration ?? null
            ));

            await this.db.batch(batch);
        }

        return runId;
    }

    async getScheduleItems(runId: number): Promise<CleaningTask[]> {
        const { results } = await this.db.prepare(`
            SELECT
                zone,
                accommodation_code as accommodationName,
                accommodation_id as accommodationId,
                is_turnover as isTurnover,
                cleaner_name as cleanerName,
                start_time as startTime,
                end_time as endTime,
                address,
                stay_duration as stayDuration
            FROM schedule_items
            WHERE run_id = ?
        `).bind(runId).all();

        return results.map((row: any) => ({
            ...row,
            isTurnover: row.isTurnover === 1,
            accommodationId: row.accommodationId || "",
            stayDuration: row.stayDuration ?? null,
            checkInDate: null,
            checkOutDate: null,
            areaM2: 0,
            effort: { teamSize: 1, estimatedMinutes: 0 }
        }));
    }

    async getRunByDate(date: string): Promise<{ id: number, status: string } | null> {
        const result = await this.db.prepare(
            `SELECT id, status FROM schedule_runs WHERE target_date = ? ORDER BY id DESC LIMIT 1`
        ).bind(date).first<{ id: number, status: string }>();

        return result || null;
    }
}