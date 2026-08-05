import {
    AccommodationIndexSyncState,
    AccommodationReferenceIndexRepository,
    DEFAULT_ACCOMMODATION_INDEX_MAX_AGE_SECONDS,
} from "../../../repositories/accommodation/accommodationReferenceIndexRepository";
import { Env } from "../../../types/configTypes";

export const ACCOMMODATION_INDEX_FUTURE_TOLERANCE_MS = 60_000;

export type AccommodationIndexStatusResult = {
    success: true;
    status: AccommodationIndexSyncState["status"];
    active_generation_available: boolean;
    building: boolean;
    processed_records: number;
    processed_pages: number;
    started_at: string | null;
    completed_at: string | null;
    age_seconds: number | null;
    max_age_seconds: number;
    fresh: boolean;
    last_error_code: string | null;
};

export function accommodationIndexMaxAgeSeconds(value: string | undefined): number {
    const configured = Number(value);
    return Number.isFinite(configured) && configured > 0
        ? Math.floor(configured)
        : DEFAULT_ACCOMMODATION_INDEX_MAX_AGE_SECONDS;
}

export class AccommodationIndexStatusService {
    private readonly repository: Pick<AccommodationReferenceIndexRepository, "getState">;
    private readonly maxAgeSeconds: number;

    constructor(
        env: Env,
        repository?: Pick<AccommodationReferenceIndexRepository, "getState">,
        private readonly now: () => Date = () => new Date(),
    ) {
        this.repository = repository ?? new AccommodationReferenceIndexRepository(env.DB);
        this.maxAgeSeconds = accommodationIndexMaxAgeSeconds(env.AVANTIO_ACCOMMODATION_INDEX_MAX_AGE_SECONDS);
    }

    async status(): Promise<AccommodationIndexStatusResult> {
        const state = await this.repository.getState();
        const nowMs = this.now().getTime();
        const completedMs = state.completed_at ? Date.parse(state.completed_at) : Number.NaN;
        const validCompletedAt = Number.isFinite(completedMs)
            && completedMs <= nowMs + ACCOMMODATION_INDEX_FUTURE_TOLERANCE_MS;
        const ageSeconds = validCompletedAt
            ? Math.max(0, Math.floor((nowMs - completedMs) / 1000))
            : null;
        const activeGenerationAvailable = !!state.active_generation_id?.trim();

        return {
            success: true,
            status: state.status,
            active_generation_available: activeGenerationAvailable,
            building: !!state.building_generation_id?.trim(),
            processed_records: state.processed_records,
            processed_pages: state.processed_pages,
            started_at: state.started_at,
            completed_at: state.completed_at,
            age_seconds: ageSeconds,
            max_age_seconds: this.maxAgeSeconds,
            fresh: activeGenerationAvailable && ageSeconds !== null && ageSeconds <= this.maxAgeSeconds,
            last_error_code: state.last_error_code,
        };
    }
}
