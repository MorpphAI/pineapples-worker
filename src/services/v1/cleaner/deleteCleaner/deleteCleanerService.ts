import { CleanerRepository } from "../../../../repositories/cleaner/cleanerRepository";
import { Env } from "../../../../types/configTypes";

export class DeleteCleanerService {
    private repo: CleanerRepository;

    constructor(env: Env) {
        this.repo = new CleanerRepository(env.DB);
    }

    async delete(id: number): Promise<boolean> {
        return this.repo.deleteById(id);
    }
}
