import {
    buildAccommodationCleaningView,
} from "../../../domain/accommodation/accommodationCleaningProfile";
import { normalizeKey } from "../../../domain/scale/zoneMatching";
import { AccommodationCleaningOverrideRepository } from "../../../repositories/accommodation/accommodationCleaningOverrideRepository";
import { AccommodationRepository } from "../../../repositories/accommodation/accommodationRepository";
import {
    AccommodationCleaningOverrideRow,
    AccommodationCleaningView,
    AccommodationFilters,
} from "../../../types/accommodationTypes";
import { Env } from "../../../types/configTypes";

export class GetAccommodationsService {
    private accommodationRepo: AccommodationRepository;
    private overrideRepo: AccommodationCleaningOverrideRepository;

    constructor(env: Env) {
        this.accommodationRepo = new AccommodationRepository(env.DB);
        this.overrideRepo = new AccommodationCleaningOverrideRepository(env.DB);
    }

    async list(filters: AccommodationFilters = {}): Promise<AccommodationCleaningView[]> {
        const [rows, overrides] = await Promise.all([
            this.accommodationRepo.findAll(),
            this.overrideRepo.findAll(),
        ]);

        const overrideByAccommodationId = new Map<string, AccommodationCleaningOverrideRow>();
        for (const override of overrides) {
            overrideByAccommodationId.set(override.accommodation_id, override);
        }

        const views = rows.map(row => buildAccommodationCleaningView(
            row,
            overrideByAccommodationId.get(row.accommodation_id) || null,
        ));

        return applyFilters(views, filters);
    }

    async getById(id: string): Promise<AccommodationCleaningView | null> {
        const row = await this.accommodationRepo.findById(id);
        if (!row) return null;

        const override = await this.overrideRepo.findByAccommodationId(id);
        return buildAccommodationCleaningView(row, override);
    }
}

function applyFilters(
    views: AccommodationCleaningView[],
    filters: AccommodationFilters
): AccommodationCleaningView[] {
    return views.filter(view => {
        if (filters.q) {
            const needle = normalizeKey(filters.q);
            const haystack = normalizeKey([
                view.accommodationId,
                view.name,
                view.address,
            ].join(" "));
            if (!haystack.includes(needle)) return false;
        }

        if (filters.zone && normalizeKey(view.effective.zone || "") !== normalizeKey(filters.zone)) {
            return false;
        }

        if (filters.hasOverride === "true" && !view.flags.hasOverride) return false;
        if (filters.hasOverride === "false" && view.flags.hasOverride) return false;

        if (filters.flags && !view.flags[filters.flags]) return false;

        if (filters.status && normalizeKey(view.status || "") !== normalizeKey(filters.status)) {
            return false;
        }

        return true;
    });
}
