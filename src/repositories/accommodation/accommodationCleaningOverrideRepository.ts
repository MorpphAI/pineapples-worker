import { D1Database } from "@cloudflare/workers-types";
import {
    AccommodationCleaningOverrideInput,
    AccommodationCleaningOverrideRow,
} from "../../types/accommodationTypes";
import { normalizeKey } from "../../domain/scale/zoneMatching";

export class AccommodationCleaningOverrideRepository {
    private db: D1Database;

    constructor(db: D1Database) {
        this.db = db;
    }

    async findAll(): Promise<AccommodationCleaningOverrideRow[]> {
        const { results } = await this.db
            .prepare("SELECT * FROM accommodation_cleaning_overrides ORDER BY accommodation_id ASC")
            .all<AccommodationCleaningOverrideRow>();

        return results || [];
    }

    async findAllActive(): Promise<AccommodationCleaningOverrideRow[]> {
        const { results } = await this.db
            .prepare("SELECT * FROM accommodation_cleaning_overrides WHERE is_active = 1 ORDER BY accommodation_id ASC")
            .all<AccommodationCleaningOverrideRow>();

        return results || [];
    }

    async findByAccommodationId(id: string): Promise<AccommodationCleaningOverrideRow | null> {
        const result = await this.db
            .prepare("SELECT * FROM accommodation_cleaning_overrides WHERE accommodation_id = ?")
            .bind(id)
            .first<AccommodationCleaningOverrideRow>();

        return result || null;
    }

    async upsert(
        accommodationId: string,
        input: AccommodationCleaningOverrideInput
    ): Promise<AccommodationCleaningOverrideRow> {
        const normalized = normalizeInput(input);
        const existing = await this.findByAccommodationId(accommodationId);

        if (!existing) {
            await this.db.prepare(`
                INSERT INTO accommodation_cleaning_overrides (
                    accommodation_id,
                    effort_units,
                    estimated_minutes,
                    required_people,
                    zone_override,
                    address_group_key_override,
                    is_active,
                    notes,
                    updated_by,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `).bind(
                accommodationId,
                normalized.effortUnits ?? null,
                normalized.estimatedMinutes ?? null,
                normalized.requiredPeople ?? null,
                normalized.zoneOverride ?? null,
                normalized.addressGroupKeyOverride ?? null,
                normalized.isActive === undefined ? 1 : normalized.isActive ? 1 : 0,
                normalized.notes ?? null,
                normalized.updatedBy ?? null,
            ).run();

            const created = await this.findByAccommodationId(accommodationId);
            if (!created) throw new Error("Falha ao salvar perfil de limpeza.");
            return created;
        }

        const setClauses: string[] = [];
        const values: unknown[] = [];

        if (has(input, "effortUnits")) { setClauses.push("effort_units = ?"); values.push(normalized.effortUnits ?? null); }
        if (has(input, "estimatedMinutes")) { setClauses.push("estimated_minutes = ?"); values.push(normalized.estimatedMinutes ?? null); }
        if (has(input, "requiredPeople")) { setClauses.push("required_people = ?"); values.push(normalized.requiredPeople ?? null); }
        if (has(input, "zoneOverride")) { setClauses.push("zone_override = ?"); values.push(normalized.zoneOverride ?? null); }
        if (has(input, "addressGroupKeyOverride")) { setClauses.push("address_group_key_override = ?"); values.push(normalized.addressGroupKeyOverride ?? null); }
        if (has(input, "isActive")) { setClauses.push("is_active = ?"); values.push(normalized.isActive ? 1 : 0); }
        if (has(input, "notes")) { setClauses.push("notes = ?"); values.push(normalized.notes ?? null); }
        if (has(input, "updatedBy")) { setClauses.push("updated_by = ?"); values.push(normalized.updatedBy ?? null); }

        if (setClauses.length > 0) {
            values.push(accommodationId);
            await this.db
                .prepare(`
                    UPDATE accommodation_cleaning_overrides
                    SET ${setClauses.join(", ")}, updated_at = CURRENT_TIMESTAMP
                    WHERE accommodation_id = ?
                `)
                .bind(...values)
                .run();
        }

        const updated = await this.findByAccommodationId(accommodationId);
        if (!updated) throw new Error("Falha ao atualizar perfil de limpeza.");
        return updated;
    }

    async deleteByAccommodationId(id: string): Promise<void> {
        await this.db
            .prepare("DELETE FROM accommodation_cleaning_overrides WHERE accommodation_id = ?")
            .bind(id)
            .run();
    }
}

function normalizeInput(input: AccommodationCleaningOverrideInput): AccommodationCleaningOverrideInput {
    validateUnit(input.effortUnits, "effortUnits");
    validateUnit(input.requiredPeople, "requiredPeople");

    if (input.estimatedMinutes !== undefined && input.estimatedMinutes !== null) {
        if (!Number.isInteger(input.estimatedMinutes) || input.estimatedMinutes <= 0) {
            throw new Error("estimatedMinutes deve ser um inteiro positivo.");
        }
    }

    if (input.isActive !== undefined && typeof input.isActive !== "boolean") {
        throw new Error("isActive deve ser booleano.");
    }

    return {
        effortUnits: input.effortUnits,
        estimatedMinutes: input.estimatedMinutes,
        requiredPeople: input.requiredPeople,
        zoneOverride: normalizeNullableString(input.zoneOverride),
        addressGroupKeyOverride: normalizeAddressGroupKey(input.addressGroupKeyOverride),
        isActive: input.isActive,
        notes: normalizeNullableString(input.notes),
        updatedBy: normalizeNullableString(input.updatedBy),
    };
}

function validateUnit(value: 1 | 2 | 3 | null | undefined, fieldName: string) {
    if (value === undefined || value === null) return;
    if (value !== 1 && value !== 2 && value !== 3) {
        throw new Error(`${fieldName} deve ser 1, 2 ou 3.`);
    }
}

function normalizeNullableString(value: string | null | undefined): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function normalizeAddressGroupKey(value: string | null | undefined): string | null | undefined {
    const normalized = normalizeNullableString(value);
    return normalized ? normalizeKey(normalized) : normalized;
}

function has(input: AccommodationCleaningOverrideInput, key: keyof AccommodationCleaningOverrideInput): boolean {
    return Object.prototype.hasOwnProperty.call(input, key);
}
