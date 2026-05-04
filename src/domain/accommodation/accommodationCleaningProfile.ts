import {
    AccommodationCleaningOverrideInput,
    AccommodationCleaningOverrideRow,
    AccommodationCleaningView,
    AccommodationRow,
} from "../../types/accommodationTypes";
import { CleaningProfileOverride } from "../../types/cleanerTypes";
import { calculateCleaningEffort } from "../scale/cleaningEffort";
import { extractZoneFromAccommodationName, normalizeKey } from "../scale/zoneMatching";

const UNIT_VALUES = new Set([1, 2, 3]);

function optional(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

function compactJoin(parts: (string | null | undefined)[], separator: string): string {
    return parts
        .map(part => optional(part))
        .filter((part): part is string => !!part)
        .join(separator);
}

function asUnit(value: number | null): 1 | 2 | 3 | undefined {
    return value === 1 || value === 2 || value === 3 ? value : undefined;
}

function requireUnit(value: number | null, fallback: 1 | 2 | 3): 1 | 2 | 3 {
    return asUnit(value) ?? fallback;
}

export function rowToAddress(row: AccommodationRow): string {
    const streetPrefix = normalizeKey(row.addr_type || "") === "AVENUE" ? "Av." : "Rua";
    const street = compactJoin([streetPrefix, row.address], " ");
    const number = optional(row.number) ? `No ${row.number}` : null;
    const door = optional(row.door) ? `AP ${row.door}` : null;
    const main = compactJoin([street, number, door], " ");
    const city = optional(row.city_name);

    if (main && city) return `${main} - ${city}`;
    return main || city || "";
}

export function rowToAddressGroupKey(row: AccommodationRow): string {
    return [
        row.addr_type,
        row.address,
        row.number,
        row.city_name,
    ]
        .map(part => optional(part))
        .filter((part): part is string => !!part)
        .map(normalizeKey)
        .join("|");
}

export function deriveSuggestedCleaningProfile(row: AccommodationRow): AccommodationCleaningView["suggested"] {
    const effort = calculateCleaningEffort(row.area_m2 ?? 0);

    return {
        zone: extractZoneFromAccommodationName(row.name),
        addressGroupKey: rowToAddressGroupKey(row),
        effortUnits: effort.effortUnits,
        estimatedMinutes: effort.estimatedMinutes,
        requiredPeople: 1,
        sizeClass: effort.sizeClass,
    };
}

export function overrideRowToCleaningProfileOverride(
    row: AccommodationCleaningOverrideRow,
    accommodationName: string
): CleaningProfileOverride {
    return {
        accommodationId: row.accommodation_id,
        accommodationName,
        effortUnits: asUnit(row.effort_units),
        estimatedMinutes: row.estimated_minutes ?? undefined,
        requiredPeople: asUnit(row.required_people),
        zoneOverride: row.zone_override ?? undefined,
        addressGroupKeyOverride: row.address_group_key_override ?? undefined,
        isActive: row.is_active === 1,
        notes: row.notes ?? undefined,
    };
}

export function buildAccommodationCleaningView(
    row: AccommodationRow,
    override: AccommodationCleaningOverrideRow | null
): AccommodationCleaningView {
    const suggested = deriveSuggestedCleaningProfile(row);
    const activeOverride = override && override.is_active === 1 ? override : null;

    const effective = {
        zone: activeOverride?.zone_override || suggested.zone,
        addressGroupKey: activeOverride?.address_group_key_override || suggested.addressGroupKey,
        effortUnits: requireUnit(activeOverride?.effort_units ?? null, suggested.effortUnits),
        estimatedMinutes: activeOverride?.estimated_minutes ?? suggested.estimatedMinutes,
        requiredPeople: requireUnit(activeOverride?.required_people ?? null, suggested.requiredPeople),
    };

    return {
        accommodationId: row.accommodation_id,
        name: row.name,
        status: row.status,
        address: rowToAddress(row),
        areaM2: row.area_m2,
        lastSeenAt: row.last_seen_at,
        suggested,
        override: override ? {
            effortUnits: asUnit(override.effort_units),
            estimatedMinutes: override.estimated_minutes ?? undefined,
            requiredPeople: asUnit(override.required_people),
            zoneOverride: override.zone_override ?? undefined,
            addressGroupKeyOverride: override.address_group_key_override ?? undefined,
            isActive: override.is_active === 1,
            notes: override.notes ?? undefined,
        } : null,
        effective,
        flags: {
            hasOverride: !!activeOverride,
            missingArea: row.area_m2 == null,
            missingZone: !suggested.zone && !activeOverride?.zone_override,
            largeWithoutReview: suggested.sizeClass === "LARGE" && !activeOverride,
        },
    };
}

export function normalizeCleaningOverrideInput(input: Record<string, unknown>): AccommodationCleaningOverrideInput {
    const allowedFields = new Set([
        "effortUnits",
        "estimatedMinutes",
        "requiredPeople",
        "zoneOverride",
        "addressGroupKeyOverride",
        "isActive",
        "notes",
        "updatedBy",
    ]);

    const unknownFields = Object.keys(input).filter(key => !allowedFields.has(key));
    if (unknownFields.length > 0) {
        throw new Error(`Campos nao editaveis: ${unknownFields.join(", ")}.`);
    }

    const output: AccommodationCleaningOverrideInput = {};

    if ("effortUnits" in input) output.effortUnits = parseUnit(input.effortUnits, "effortUnits");
    if ("requiredPeople" in input) output.requiredPeople = parseUnit(input.requiredPeople, "requiredPeople");
    if ("estimatedMinutes" in input) output.estimatedMinutes = parsePositiveInteger(input.estimatedMinutes, "estimatedMinutes");
    if ("zoneOverride" in input) output.zoneOverride = parseNullableString(input.zoneOverride, "zoneOverride");
    if ("addressGroupKeyOverride" in input) output.addressGroupKeyOverride = parseNullableString(input.addressGroupKeyOverride, "addressGroupKeyOverride");
    if ("notes" in input) output.notes = parseNullableString(input.notes, "notes");
    if ("updatedBy" in input) output.updatedBy = parseNullableString(input.updatedBy, "updatedBy");
    if ("isActive" in input) {
        if (typeof input.isActive !== "boolean") throw new Error("isActive deve ser booleano.");
        output.isActive = input.isActive;
    }

    return output;
}

function parseUnit(value: unknown, fieldName: string): 1 | 2 | 3 | null {
    if (value === null) return null;
    if (typeof value !== "number" || !Number.isInteger(value) || !UNIT_VALUES.has(value)) {
        throw new Error(`${fieldName} deve ser 1, 2, 3 ou null.`);
    }
    return value as 1 | 2 | 3;
}

function parsePositiveInteger(value: unknown, fieldName: string): number | null {
    if (value === null) return null;
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        throw new Error(`${fieldName} deve ser um inteiro positivo ou null.`);
    }
    return value;
}

function parseNullableString(value: unknown, fieldName: string): string | null {
    if (value === null) return null;
    if (typeof value !== "string") throw new Error(`${fieldName} deve ser texto ou null.`);
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}
