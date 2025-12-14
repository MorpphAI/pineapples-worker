import { D1Database } from "@cloudflare/workers-types";
import { Cleaner, NewCleaner } from "../../types/cleanerTypes";

export class CleanerRepository {
    private db: D1Database;

    constructor(db: D1Database) {
        this.db = db;
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

   async createBatch(cleaners: NewCleaner[]): Promise<boolean> {
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
}