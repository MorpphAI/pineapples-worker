import { AvantioAccommodationPage, AvantioApiGateway } from "../../../apiGateways/avantio/getAppointments";
import { authoritativeAccommodationId } from "../../../integrations/avantio/accommodations/lookup";
import { AvantioProviderError } from "../../../integrations/avantio/accommodations/providerErrors";
import {
    AccommodationIndexError,
    AccommodationIndexRecord,
    AccommodationIndexSyncState,
    AccommodationReferenceIndexRepository,
} from "../../../repositories/accommodation/accommodationReferenceIndexRepository";
import { AccommodationRepository } from "../../../repositories/accommodation/accommodationRepository";
import { Env } from "../../../types/configTypes";
import { AvantioAccommodation } from "../../../types/avantioTypes";

export const ACCOMMODATION_SYNC_PAGE_SIZE = 10;
export const ACCOMMODATION_SYNC_MAX_PROVIDER_REQUESTS = 20;
export const ACCOMMODATION_SYNC_LEASE_SECONDS = 300;

export type AccommodationSyncResult = {
    synced: number;
    complete: boolean;
    processed_records: number;
    processed_pages: number;
    active_generation_available: boolean;
    building: boolean;
};

export class AccommodationSyncError extends Error {
    constructor(public readonly code: string, message: string) {
        super(message);
        this.name = "AccommodationSyncError";
    }
}

export class ProviderSubrequestBudget {
    private used = 0;
    constructor(private readonly maximum = ACCOMMODATION_SYNC_MAX_PROVIDER_REQUESTS) {}

    consume(): void {
        if (this.used >= this.maximum) {
            throw new AccommodationSyncError("provider_subrequest_budget_exhausted", "O limite interno de consultas ao provedor foi atingido.");
        }
        this.used += 1;
    }

    get count(): number { return this.used; }
}

type SyncGateway = Pick<AvantioApiGateway, "getAccommodationsPage" | "getAccommodationStrict">;
type ReferenceIndex = Pick<AccommodationReferenceIndexRepository, "getState" | "acquireBatchLease" | "renewBatchLease" | "releaseBatchLease" | "startGeneration" | "resumeGeneration" | "markBatchFailed" | "savePage">;
type AccommodationCache = Pick<AccommodationRepository, "upsertMany">;

function optionalString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function syncError(error: unknown): AccommodationSyncError {
    if (error instanceof AccommodationSyncError) return error;
    if (error instanceof AccommodationIndexError) return new AccommodationSyncError(error.code, error.message);
    if (error instanceof AvantioProviderError) return new AccommodationSyncError(error.code, error.message);
    return new AccommodationSyncError("accommodation_index_batch_failed", "A atualização incremental do índice falhou.");
}

function logSyncDiagnostic(stage: string, code: string): void {
    console.error(`[AccommodationIndexSync] stage=${stage} code=${code}`);
}

export class SyncAccommodationsService {
    private readonly avantioApiGateway: SyncGateway;
    private readonly accommodationRepo: AccommodationCache;
    private readonly referenceIndex: ReferenceIndex;

    constructor(
        env: Env,
        gateway?: SyncGateway,
        referenceIndex?: ReferenceIndex,
        accommodationRepo?: AccommodationCache,
        private readonly now: () => Date = () => new Date(),
        private readonly generationId: () => string = () => crypto.randomUUID(),
        private readonly leaseId: () => string = () => crypto.randomUUID(),
    ) {
        this.avantioApiGateway = gateway ?? new AvantioApiGateway(env);
        this.accommodationRepo = accommodationRepo ?? new AccommodationRepository(env.DB);
        this.referenceIndex = referenceIndex ?? new AccommodationReferenceIndexRepository(env.DB);
    }

    async sync(): Promise<AccommodationSyncResult> {
        const budget = new ProviderSubrequestBudget();
        let state: AccommodationIndexSyncState | null = null;
        const leaseOwner = this.leaseId();
        let leaseAcquired = false;
        try {
            const leaseStartedAt = this.now();
            const leaseExpiresAt = new Date(leaseStartedAt.getTime() + ACCOMMODATION_SYNC_LEASE_SECONDS * 1000);
            leaseAcquired = await this.referenceIndex.acquireBatchLease(leaseOwner, leaseStartedAt.toISOString(), leaseExpiresAt.toISOString());
            if (!leaseAcquired) {
                throw new AccommodationSyncError("accommodation_index_busy", "Outro lote do índice já está em execução.");
            }

            state = await this.referenceIndex.getState();
            const now = this.now().toISOString();
            if (!state.building_generation_id) {
                state = await this.referenceIndex.startGeneration(this.generationId(), now);
            } else if (state.status === "failed") {
                state = await this.referenceIndex.resumeGeneration(now);
            }
            if (!state.building_generation_id) {
                throw new AccommodationSyncError("accommodation_index_batch_failed", "Não foi possível iniciar uma geração do índice.");
            }

            const renewalStartedAt = this.now();
            const renewedUntil = new Date(renewalStartedAt.getTime() + ACCOMMODATION_SYNC_LEASE_SECONDS * 1000);
            const leaseRenewed = await this.referenceIndex.renewBatchLease(leaseOwner, renewalStartedAt.toISOString(), renewedUntil.toISOString());
            if (!leaseRenewed) {
                throw new AccommodationSyncError("accommodation_index_lease_lost", "A posse do lote de sincronização expirou.");
            }

            budget.consume();
            const page: AvantioAccommodationPage = await this.avantioApiGateway.getAccommodationsPage(state.next_page_url, ACCOMMODATION_SYNC_PAGE_SIZE);
            if (page.records.length > ACCOMMODATION_SYNC_PAGE_SIZE) {
                throw new AccommodationSyncError("provider_subrequest_budget_exhausted", "A página do provedor excedeu o limite interno.");
            }

            const inspectedAt = this.now().toISOString();
            const indexRecords: AccommodationIndexRecord[] = [];
            const cacheRecords: AvantioAccommodation[] = [];
            for (const listRecord of page.records) {
                const accommodationId = authoritativeAccommodationId(listRecord);
                if (!accommodationId) {
                    throw new AccommodationSyncError("accommodation_index_record_invalid", "Uma acomodação não possui ID autoritativo.");
                }

                let inspected = listRecord;
                let externalReference: string | null;
                if (typeof listRecord.externalReference === "string") {
                    externalReference = listRecord.externalReference;
                } else {
                    budget.consume();
                    try {
                        inspected = await this.avantioApiGateway.getAccommodationStrict(accommodationId);
                    } catch {
                        throw new AccommodationSyncError("accommodation_index_detail_failed", "O detalhe de uma acomodação não pôde ser inspecionado.");
                    }
                    if (inspected.externalReference === undefined || inspected.externalReference === null) {
                        externalReference = null;
                    } else if (typeof inspected.externalReference === "string") {
                        externalReference = inspected.externalReference;
                    } else {
                        throw new AccommodationSyncError("accommodation_index_detail_failed", "O detalhe contém uma referência externa inválida.");
                    }
                }

                const merged = { ...listRecord, ...inspected, id: accommodationId } as unknown as AvantioAccommodation;
                indexRecords.push({
                    accommodation_id: accommodationId,
                    external_reference: externalReference,
                    name: optionalString(inspected.name ?? listRecord.name),
                    remote_status: optionalString(inspected.status ?? listRecord.status),
                    inspected_at: inspectedAt,
                });
                cacheRecords.push(merged);
            }

            try {
                await this.accommodationRepo.upsertMany(cacheRecords);
            } catch {
                logSyncDiagnostic("d1_cache_write", "accommodation_index_cache_write_failed");
                throw new AccommodationSyncError("accommodation_index_cache_write_failed", "Accommodation cache write failed.");
            }

            let saved: AccommodationIndexSyncState;
            try {
                saved = await this.referenceIndex.savePage(state.building_generation_id, indexRecords, page.nextPageUrl, inspectedAt, leaseOwner);
            } catch (error) {
                const code = error instanceof AccommodationIndexError ? error.code : "accommodation_index_index_write_failed";
                logSyncDiagnostic("d1_index_write", code);
                if (error instanceof AccommodationIndexError) throw error;
                throw new AccommodationSyncError(code, "Accommodation index write failed.");
            }
            return {
                synced: indexRecords.length,
                complete: !saved.building_generation_id && saved.active_generation_id === state.building_generation_id,
                processed_records: saved.processed_records,
                processed_pages: saved.processed_pages,
                active_generation_available: !!saved.active_generation_id,
                building: !!saved.building_generation_id,
            };
        } catch (error) {
            const normalized = syncError(error);
            if (state?.building_generation_id) {
                try { await this.referenceIndex.markBatchFailed(normalized.code, this.now().toISOString(), leaseOwner); } catch { /* preserve the original sanitized failure */ }
            }
            throw normalized;
        } finally {
            if (leaseAcquired) {
                try {
                    await this.referenceIndex.releaseBatchLease(leaseOwner);
                } catch {
                    logSyncDiagnostic("lease_release", "accommodation_index_lease_release_failed");
                }
            }
        }
    }
}
