import { CleanerRepository } from "../../repositories/cleaner/cleanerRepository";
import { NewCleaner, Cleaner } from "../../types/cleanerTypes";
import { Env } from "../../types/configTypes"; 

export class CleanerService {
    private repo: CleanerRepository;

    constructor(env: Env) {
        this.repo = new CleanerRepository(env.DB);
    }

    async registerCleanersBatch(cleaners: NewCleaner[]) {
        const normalized = cleaners.map(c => ({
            ...c,
            name: c.name.trim().toUpperCase()
        }));

        return this.repo.CreateCleaners(normalized);
    }

    async getActiveTeam() {
        return this.repo.findAllActive();
    }
}