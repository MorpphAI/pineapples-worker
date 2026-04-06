import { ScaleRepository } from "../../../../repositories/scale/scaleRepository";
import { Env } from "../../../../types/configTypes";

export class GetScaleHistoryService {
    private repo: ScaleRepository;

    constructor(env: Env) {
        this.repo = new ScaleRepository(env.DB);
    }

    async getHistory() {
        return this.repo.getAllRuns();
    }
}
