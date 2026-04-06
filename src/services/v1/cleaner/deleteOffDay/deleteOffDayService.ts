import { OffDayRepository } from "../../../../repositories/cleaner/offDayRepository";
import { Env } from "../../../../types/configTypes";

export class DeleteOffDayService {
    private repo: OffDayRepository;

    constructor(env: Env) {
        this.repo = new OffDayRepository(env.DB);
    }

    async delete(id: number): Promise<boolean> {
        return this.repo.deleteById(id);
    }
}
