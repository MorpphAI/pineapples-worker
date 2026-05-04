import { buildAccommodationCleaningView } from "../../../domain/accommodation/accommodationCleaningProfile";
import { AccommodationCleaningOverrideRepository } from "../../../repositories/accommodation/accommodationCleaningOverrideRepository";
import { AccommodationRepository } from "../../../repositories/accommodation/accommodationRepository";
import { AccommodationCleaningView } from "../../../types/accommodationTypes";
import { Env } from "../../../types/configTypes";

export class ResetAccommodationCleaningProfileService {
    private accommodationRepo: AccommodationRepository;
    private overrideRepo: AccommodationCleaningOverrideRepository;

    constructor(env: Env) {
        this.accommodationRepo = new AccommodationRepository(env.DB);
        this.overrideRepo = new AccommodationCleaningOverrideRepository(env.DB);
    }

    async reset(accommodationId: string): Promise<AccommodationCleaningView | null> {
        const row = await this.accommodationRepo.findById(accommodationId);
        if (!row) return null;

        await this.overrideRepo.deleteByAccommodationId(accommodationId);
        return buildAccommodationCleaningView(row, null);
    }
}
