import { D1Database } from "@cloudflare/workers-types";
import { OffDayResult } from "../../types/cleanerTypes";
import { OffDayScheduleInput } from "../../types/cleanerTypes";

export class OffDayRepository {
    private db: D1Database;

    constructor(db: D1Database) {
        this.db = db;
    }

    async saveMonthlySchedule(input: OffDayScheduleInput): Promise<boolean> {
        const { month, schedules } = input;
        
        const deleteStmt = this.db.prepare(
            "DELETE FROM cleaner_off_days WHERE date LIKE ?"
        ).bind(`${month}-%`);

        const insertStmt = this.db.prepare(
            "INSERT INTO cleaner_off_days (cleaner_id, date, reason) VALUES (?, ?, ?)"
        );

        const inserts = [];

        for (const item of schedules) {
            for (const day of item.offDays) {
                if (day.startsWith(month)) {
                    inserts.push(insertStmt.bind(item.cleanerId, day, item.reason || "Folga Escala"));
                }
            }
        }

        try {
            await this.db.batch([deleteStmt, ...inserts]);
            return true;
        } catch (error) {
            console.error("[OffDayRepository] Erro ao salvar escala:", error);
            throw new Error("Falha ao salvar escala de folgas.");
        }
    }

    async getCleanersOffByDate(date: string): Promise<number[]> {
        const { results } = await this.db.prepare(
            "SELECT cleaner_id FROM cleaner_off_days WHERE date = ?"
        ).bind(date).all<{ cleaner_id: number }>();

        return results.map(r => r.cleaner_id);
    }

    async getOffDaysByMonth(month: string): Promise<OffDayResult[]> {
        const pattern = `${month}-%`;
        
        try {
            const { results } = await this.db.prepare(`
                SELECT 
                    c.id as cleanerId, 
                    c.name as cleanerName, 
                    o.date, 
                    o.reason 
                FROM cleaner_off_days o
                JOIN cleaners c ON c.id = o.cleaner_id
                WHERE o.date LIKE ?
                ORDER BY o.date ASC, c.name ASC
            `).bind(pattern).all<OffDayResult>();

            return results || [];
        } catch (error) {
            console.error("[OffDayRepository] Erro ao buscar folgas do mês:", error);
            return [];
        }
    }
}