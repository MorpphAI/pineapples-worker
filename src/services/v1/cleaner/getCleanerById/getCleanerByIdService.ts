import { CleanerRepository } from "../../../../repositories/cleaner/cleanerRepository";
import { Env } from "../../../../types/configTypes";
import { Cleaner } from "../../../../types/cleanerTypes";

export class GetCleanerByIdService {
    private repo: CleanerRepository;

    constructor(env: Env) {
        this.repo = new CleanerRepository(env.DB);
    }

    async getById(id: number): Promise<Cleaner | null> {
        return this.repo.findById(id);
    }
}
