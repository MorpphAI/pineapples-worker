import { CleanerRepository } from "../../../../repositories/cleaner/cleanerRepository";
import { Env } from "../../../../types/configTypes";

export class UpdateCleanerService {
    private repo: CleanerRepository;

    constructor(env: Env) {
        this.repo = new CleanerRepository(env.DB);
    }

    async updateStatus(id: number, isActive: boolean): Promise<boolean> {
        return this.repo.updateActiveStatus(id, isActive);
    }
}
