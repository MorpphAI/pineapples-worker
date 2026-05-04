import {
    buildAccommodationCleaningView,
    normalizeCleaningOverrideInput,
} from "../../../domain/accommodation/accommodationCleaningProfile";
import { AccommodationCleaningOverrideRepository } from "../../../repositories/accommodation/accommodationCleaningOverrideRepository";
import { AccommodationRepository } from "../../../repositories/accommodation/accommodationRepository";
import { AccommodationCleaningView } from "../../../types/accommodationTypes";
import { Env } from "../../../types/configTypes";

export class UpdateAccommodationCleaningProfileService {
    private accommodationRepo: AccommodationRepository;
    private overrideRepo: AccommodationCleaningOverrideRepository;

    constructor(env: Env) {
        this.accommodationRepo = new AccommodationRepository(env.DB);
        this.overrideRepo = new AccommodationCleaningOverrideRepository(env.DB);
    }

    async update(
        accommodationId: string,
        body: Record<string, unknown>
    ): Promise<AccommodationCleaningView | null> {
        if (!body || Array.isArray(body) || Object.keys(body).length === 0) {
            throw new Error("Pelo menos um campo deve ser fornecido.");
        }

        const input = normalizeCleaningOverrideInput(body);
        const row = await this.accommodationRepo.findById(accommodationId);
        if (!row) return null;

        const override = await this.overrideRepo.upsert(accommodationId, input);
        return buildAccommodationCleaningView(row, override);
    }
}
