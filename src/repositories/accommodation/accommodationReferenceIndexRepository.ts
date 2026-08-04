import { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { AccommodationCandidate } from "../../integrations/avantio/accommodations/lookup";

export const DEFAULT_ACCOMMODATION_INDEX_MAX_AGE_SECONDS = 900;

export type AccommodationIndexStatus = "idle" | "building" | "complete" | "failed";

export type AccommodationIndexSyncState = {
  singleton_id: number;
  active_generation_id: string | null;
  building_generation_id: string | null;
  next_page_url: string | null;
  status: AccommodationIndexStatus;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  processed_records: number;
  processed_pages: number;
  last_error_code: string | null;
};

export type AccommodationIndexRecord = {
  accommodation_id: string;
  external_reference: string | null;
  name: string | null;
  remote_status: string | null;
  inspected_at: string;
};

export class AccommodationIndexError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AccommodationIndexError";
  }
}

function mapDatabaseError(error: unknown): AccommodationIndexError {
  const message = error instanceof Error ? error.message : String(error);
  if (/no such table|does not exist/i.test(message)) {
    return new AccommodationIndexError("accommodation_index_uninitialized", "O índice de acomodações ainda não foi inicializado.");
  }
  return new AccommodationIndexError("accommodation_index_refresh_required", "O índice de acomodações não pôde ser consultado com segurança.");
}

export class AccommodationReferenceIndexRepository {
  constructor(private readonly db: D1Database) {}

  async getState(): Promise<AccommodationIndexSyncState> {
    try {
      const state = await this.db.prepare(`
        SELECT singleton_id, active_generation_id, building_generation_id, next_page_url, status,
               started_at, completed_at, updated_at, processed_records, processed_pages, last_error_code
        FROM avantio_accommodation_index_sync_state
        WHERE singleton_id = 1
      `).first<AccommodationIndexSyncState>();
      if (!state) throw new AccommodationIndexError("accommodation_index_uninitialized", "O estado do índice de acomodações não existe.");
      return state;
    } catch (error) {
      if (error instanceof AccommodationIndexError) throw error;
      throw mapDatabaseError(error);
    }
  }

  async startGeneration(generationId: string, now: string): Promise<AccommodationIndexSyncState> {
    try {
      await this.db.prepare(`
        UPDATE avantio_accommodation_index_sync_state
        SET building_generation_id = ?, next_page_url = NULL, status = 'building', started_at = ?,
            updated_at = ?, processed_records = 0, processed_pages = 0, last_error_code = NULL
        WHERE singleton_id = 1 AND building_generation_id IS NULL
      `).bind(generationId, now, now).run();
      return this.getState();
    } catch (error) {
      if (error instanceof AccommodationIndexError) throw error;
      throw mapDatabaseError(error);
    }
  }

  async resumeGeneration(now: string): Promise<AccommodationIndexSyncState> {
    try {
      await this.db.prepare(`
        UPDATE avantio_accommodation_index_sync_state
        SET status = 'building', updated_at = ?, last_error_code = NULL
        WHERE singleton_id = 1 AND building_generation_id IS NOT NULL
      `).bind(now).run();
      return this.getState();
    } catch (error) {
      if (error instanceof AccommodationIndexError) throw error;
      throw mapDatabaseError(error);
    }
  }

  async markBatchFailed(code: string, now: string): Promise<void> {
    try {
      await this.db.prepare(`
        UPDATE avantio_accommodation_index_sync_state
        SET status = 'failed', updated_at = ?, last_error_code = ?
        WHERE singleton_id = 1 AND building_generation_id IS NOT NULL
      `).bind(now, code).run();
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async savePage(generationId: string, records: AccommodationIndexRecord[], nextPageUrl: string | null, now: string): Promise<AccommodationIndexSyncState> {
    try {
      const statements: D1PreparedStatement[] = records.map((record) => this.db.prepare(`
        INSERT INTO avantio_accommodation_reference_index (
          generation_id, accommodation_id, external_reference, name, remote_status, inspected_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(generation_id, accommodation_id) DO UPDATE SET
          external_reference = excluded.external_reference,
          name = excluded.name,
          remote_status = excluded.remote_status,
          inspected_at = excluded.inspected_at
      `).bind(generationId, record.accommodation_id, record.external_reference, record.name, record.remote_status, record.inspected_at));

      if (nextPageUrl) {
        statements.push(this.db.prepare(`
          UPDATE avantio_accommodation_index_sync_state
          SET next_page_url = ?, status = 'building', updated_at = ?,
              processed_records = processed_records + ?, processed_pages = processed_pages + 1,
              last_error_code = NULL
          WHERE singleton_id = 1 AND building_generation_id = ?
        `).bind(nextPageUrl, now, records.length, generationId));
      } else {
        statements.push(this.db.prepare(`
          UPDATE avantio_accommodation_index_sync_state
          SET active_generation_id = ?, building_generation_id = NULL, next_page_url = NULL,
              status = 'complete', completed_at = ?, updated_at = ?,
              processed_records = processed_records + ?, processed_pages = processed_pages + 1,
              last_error_code = NULL
          WHERE singleton_id = 1 AND building_generation_id = ?
        `).bind(generationId, now, now, records.length, generationId));
        statements.push(this.db.prepare(`
          DELETE FROM avantio_accommodation_reference_index
          WHERE generation_id <> ?
            AND EXISTS (
              SELECT 1 FROM avantio_accommodation_index_sync_state
              WHERE singleton_id = 1 AND active_generation_id = ? AND building_generation_id IS NULL
            )
        `).bind(generationId, generationId));
      }

      await this.db.batch(statements);
      return this.getState();
    } catch (error) {
      if (error instanceof AccommodationIndexError) throw error;
      throw mapDatabaseError(error);
    }
  }

  async findFreshExactMatches(reference: string, maxAgeSeconds: number, now = new Date()): Promise<AccommodationCandidate[]> {
    const state = await this.getState();
    if (!state.active_generation_id?.trim() || !state.completed_at) {
      throw new AccommodationIndexError("accommodation_index_refresh_required", "Conclua uma atualização completa do índice de acomodações.");
    }
    const completedAt = Date.parse(state.completed_at);
    if (!Number.isFinite(completedAt) || now.getTime() - completedAt > maxAgeSeconds * 1000 || completedAt > now.getTime() + 60_000) {
      throw new AccommodationIndexError("accommodation_index_refresh_required", "O índice de acomodações está desatualizado.");
    }

    try {
      const { results } = await this.db.prepare(`
        SELECT accommodation_id AS external_id,
               external_reference,
               name AS label,
               remote_status
        FROM avantio_accommodation_reference_index
        WHERE generation_id = ?
          AND external_reference = ? COLLATE BINARY
          AND LENGTH(TRIM(accommodation_id)) > 0
        ORDER BY accommodation_id ASC
      `).bind(state.active_generation_id, reference).all<AccommodationCandidate>();
      return results ?? [];
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async markRefreshRequired(code = "accommodation_index_refresh_required"): Promise<void> {
    try {
      await this.db.prepare(`
        UPDATE avantio_accommodation_index_sync_state
        SET last_error_code = ?, updated_at = CURRENT_TIMESTAMP
        WHERE singleton_id = 1
      `).bind(code).run();
    } catch {
      // Lookup already fails closed; this diagnostic update is best effort only.
    }
  }

  async upsertIntoActiveGeneration(record: AccommodationIndexRecord): Promise<void> {
    const state = await this.getState();
    if (!state.active_generation_id || !state.completed_at) {
      throw new AccommodationIndexError("accommodation_index_refresh_required", "Não há geração ativa para atualizar.");
    }
    try {
      await this.db.prepare(`
        INSERT INTO avantio_accommodation_reference_index (
          generation_id, accommodation_id, external_reference, name, remote_status, inspected_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(generation_id, accommodation_id) DO UPDATE SET
          external_reference = excluded.external_reference,
          name = excluded.name,
          remote_status = excluded.remote_status,
          inspected_at = excluded.inspected_at
      `).bind(state.active_generation_id, record.accommodation_id, record.external_reference, record.name, record.remote_status, record.inspected_at).run();
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
