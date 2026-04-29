export function normalizeKey(value: string): string {
    return value
        .toUpperCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/\s+/g, " ")
        .trim();
}

export function cleanerCanWorkZone(cleaner: { zones: string }, zone: string): boolean {
    const target = normalizeKey(zone);
    return cleaner.zones
        .split(",")
        .map(z => normalizeKey(z))
        .filter(Boolean)
        .includes(target);
}

export function extractZoneFromAccommodationName(name: string): string | null {
    const normalized = name.toUpperCase();

    const zonaMatch = normalized.match(/ZONA\s*(\d+)/);
    if (zonaMatch) {
        return `ZONA${zonaMatch[1]}`;
    }

    if (normalized.includes("BARRA")) {
        return "BARRA";
    }

    return null;
}
