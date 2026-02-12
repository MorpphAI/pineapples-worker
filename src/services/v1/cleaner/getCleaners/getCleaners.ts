import { CleanerRepository } from "../../../../repositories/cleaner/cleanerRepository";
import { Env } from "../../../../types/configTypes";

export class CleanerService {
    private repo: CleanerRepository;

    constructor(env: Env) {
        this.repo = new CleanerRepository(env.DB);
    }

    async listAllCleaners() {
        return this.repo.findAll();
    }
}