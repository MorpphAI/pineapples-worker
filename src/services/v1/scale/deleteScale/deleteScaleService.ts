import { ScaleRepository } from "../../../../repositories/scale/scaleRepository";
import { Env } from "../../../../types/configTypes";

export class DeleteScaleService {
    private repo: ScaleRepository;

    constructor(env: Env) {
        this.repo = new ScaleRepository(env.DB);
    }

    async delete(runId: number): Promise<boolean> {
        return this.repo.deleteRun(runId);
    }
}
