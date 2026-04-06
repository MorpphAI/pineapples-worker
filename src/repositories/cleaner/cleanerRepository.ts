import { D1Database } from "@cloudflare/workers-types";
import { Cleaner, NewCleaner, UpdateCleanerFields } from "../../types/cleanerTypes";

export class CleanerRepository {
    private db: D1Database;

    constructor(db: D1Database) {
        this.db = db;
    }

    async findById(id: number): Promise<Cleaner | null> {
        try {
            const result = await this.db
                .prepare("SELECT * FROM cleaners WHERE id = ?")
                .bind(id)
                .first<Cleaner>();
            return result || null;
        } catch (error) {
            console.error("[CleanerRepository] Erro ao buscar faxineira por ID:", error);
            return null;
        }
    }

    async updateCleaner(id: number, fields: UpdateCleanerFields): Promise<boolean> {
        const setClauses: string[] = [];
        const values: any[] = [];

        if (fields.name !== undefined) { setClauses.push("name = ?"); values.push(fields.name); }
        if (fields.zones !== undefined) { setClauses.push("zones = ?"); values.push(fields.zones); }
        if (fields.shift_start !== undefined) { setClauses.push("shift_start = ?"); values.push(fields.shift_start); }
        if (fields.shift_end !== undefined) { setClauses.push("shift_end = ?"); values.push(fields.shift_end); }
        if (fields.fixed_accommodations !== undefined) { setClauses.push("fixed_accommodations = ?"); values.push(fields.fixed_accommodations); }
        if (fields.is_fixed !== undefined) { setClauses.push("is_fixed = ?"); values.push(fields.is_fixed ? 1 : 0); }
        if (fields.is_active !== undefined) { setClauses.push("is_active = ?"); values.push(fields.is_active ? 1 : 0); }

        if (setClauses.length === 0) return false;

        values.push(id);
        try {
            const result = await this.db
                .prepare(`UPDATE cleaners SET ${setClauses.join(", ")} WHERE id = ?`)
                .bind(...values)
                .run();
            return result.meta.changes > 0;
        } catch (error) {
            console.error("[CleanerRepository] Erro ao atualizar faxineira:", error);
            throw new Error("Falha ao atualizar faxineira.");
        }
    }

     async findAllActive(): Promise<Cleaner[]> {
        try {
            const { results } = await this.db
                .prepare("SELECT * FROM cleaners WHERE is_active = 1 ORDER BY name ASC")
                .all<Cleaner>();
            
            return results || [];
        } catch (error) {
            console.error("[CleanerRepository] Erro ao buscar equipe ativa:", error);
            return [];
        }
     }
    
    async findAll(): Promise<Cleaner[]> {
        try {
            const { results } = await this.db
                .prepare("SELECT * FROM cleaners ORDER BY name ASC")
                .all<Cleaner>();
            
            return results || [];
        } catch (error) {
            console.error("[CleanerRepository] Erro ao buscar todas:", error);
            return [];
        }
    }

   async CreateCleaners(cleaners: NewCleaner[]): Promise<boolean> {
        if (cleaners.length === 0) return true;

        const stmt = this.db.prepare(
            `INSERT INTO cleaners (name, zones, shift_start, shift_end, fixed_accommodations, is_fixed) VALUES (?, ?, ?, ?, ?, ?)`
        );

        const batch = cleaners.map((c) => 
            stmt.bind(
                c.name, 
                c.zones, 
                c.shift_start, 
                c.shift_end,
                c.fixed_accommodations || null,
                c.is_fixed ? 1 : 0
            )
        );

        try {
            await this.db.batch(batch);
            return true;
        } catch (error) {
            console.error("[CleanerRepository] Erro no batch insert:", error);
            throw new Error("Falha ao salvar lista de colaboradores.");
        }
    }

    async updateActiveStatus(id: number, isActive: boolean): Promise<boolean> {
        try {
            const result = await this.db
                .prepare("UPDATE cleaners SET is_active = ? WHERE id = ?")
                .bind(isActive ? 1 : 0, id)
                .run();

            return result.meta.changes > 0;
        } catch (error) {
            console.error("[CleanerRepository] Erro ao atualizar status:", error);
            throw new Error("Falha ao atualizar status da faxineira.");
        }
    }

    async deleteById(id: number): Promise<boolean> {
        try {
            const result = await this.db
                .prepare("DELETE FROM cleaners WHERE id = ?")
                .bind(id)
                .run();

            return result.meta.changes > 0;
        } catch (error) {
            console.error("[CleanerRepository] Erro ao deletar faxineira:", error);
            throw new Error("Falha ao deletar faxineira.");
        }
    }
}