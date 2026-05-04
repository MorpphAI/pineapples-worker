import { CleaningEffort, CleaningProfileOverride } from "../../types/cleanerTypes";
import { normalizeKey } from "./zoneMatching";

function coerceBoolean(value: unknown): boolean {
    if (value === undefined || value === null || value === "") return true;
    if (typeof value === "boolean") return value;
    const normalized = normalizeKey(String(value));
    return !["FALSE", "FALSO", "0", "NO", "NAO", "N"].includes(normalized);
}

function coerceUnit(value: unknown): 1 | 2 | 3 | null {
    if (value === undefined || value === null || value === "") return null;
    const parsed = Number(value);
    return parsed === 1 || parsed === 2 || parsed === 3 ? parsed : null;
}

function coercePositiveInteger(value: unknown): number | null {
    if (value === undefined || value === null || value === "") return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return null;
    return parsed;
}

export function normalizeCleaningProfiles(input: unknown): { profiles: CleaningProfileOverride[]; warnings: string[] } {
    const warnings: string[] = [];
    if (!Array.isArray(input)) return { profiles: [], warnings };

    const profiles: CleaningProfileOverride[] = [];
    input.forEach((row: any, index) => {
        if (!row || typeof row !== "object") {
            warnings.push(`Perfil de limpeza ${index + 1} ignorado: linha invalida.`);
            return;
        }

        if (!coerceBoolean(row.isActive)) return;

        const accommodationName = String(row.accommodationName || "").trim();
        if (!accommodationName) {
            warnings.push(`Perfil de limpeza ${index + 1} ignorado: accommodationName obrigatorio.`);
            return;
        }

        const effortUnits = coerceUnit(row.effortUnits);
        if (row.effortUnits !== undefined && row.effortUnits !== "" && effortUnits === null) {
            warnings.push(`Perfil de limpeza ${accommodationName} ignorado: effortUnits deve ser 1, 2 ou 3.`);
            return;
        }

        const requiredPeople = coerceUnit(row.requiredPeople) ?? 1;
        if (row.requiredPeople !== undefined && row.requiredPeople !== "" && coerceUnit(row.requiredPeople) === null) {
            warnings.push(`Perfil de limpeza ${accommodationName} ignorado: requiredPeople deve ser 1, 2 ou 3.`);
            return;
        }

        const estimatedMinutes = coercePositiveInteger(row.estimatedMinutes);
        if (row.estimatedMinutes !== undefined && row.estimatedMinutes !== "" && estimatedMinutes === null) {
            warnings.push(`Perfil de limpeza ${accommodationName} ignorado: estimatedMinutes deve ser inteiro positivo.`);
            return;
        }

        profiles.push({
            accommodationId: row.accommodationId ? String(row.accommodationId).trim() : undefined,
            accommodationName,
            effortUnits: effortUnits ?? undefined,
            estimatedMinutes: estimatedMinutes ?? undefined,
            requiredPeople,
            zoneOverride: row.zoneOverride ? String(row.zoneOverride).trim() : undefined,
            addressGroupKeyOverride: row.addressGroupKeyOverride ? normalizeKey(String(row.addressGroupKeyOverride)) : undefined,
            isActive: true,
            notes: row.notes ? String(row.notes) : undefined,
        });
    });

    return { profiles, warnings };
}

export function findCleaningProfile(
    profiles: CleaningProfileOverride[],
    accommodationId: string,
    accommodationName: string
): CleaningProfileOverride | null {
    const byId = profiles.find(profile => profile.accommodationId && profile.accommodationId === accommodationId);
    if (byId) return byId;
    const targetName = normalizeKey(accommodationName);
    return profiles.find(profile => normalizeKey(profile.accommodationName) === targetName) || null;
}

export function mergeCleaningProfiles(
    baseProfiles: CleaningProfileOverride[],
    overridingProfiles: CleaningProfileOverride[]
): CleaningProfileOverride[] {
    const merged = baseProfiles.slice();

    for (const override of overridingProfiles) {
        const existingIndex = merged.findIndex(profile => profilesMatch(profile, override));
        if (existingIndex >= 0) {
            merged[existingIndex] = override;
        } else {
            merged.push(override);
        }
    }

    return merged;
}

export function applyCleaningProfile(
    fallback: CleaningEffort,
    profile?: CleaningProfileOverride | null
): CleaningEffort {
    if (!profile) return fallback;
    return {
        effortUnits: profile.effortUnits ?? fallback.effortUnits,
        estimatedMinutes: profile.estimatedMinutes ?? fallback.estimatedMinutes,
        requiredPeople: profile.requiredPeople ?? 1,
        sizeClass: "CUSTOM",
    };
}

function profilesMatch(
    left: CleaningProfileOverride,
    right: CleaningProfileOverride
): boolean {
    if (left.accommodationId && right.accommodationId && left.accommodationId === right.accommodationId) {
        return true;
    }

    return normalizeKey(left.accommodationName) === normalizeKey(right.accommodationName);
}
