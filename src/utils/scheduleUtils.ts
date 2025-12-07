import { BookingStatus } from "../types/avantioTypes";
import { CleaningEffort } from "../types/cleanerTypes";

export function isValidBookingStatus(status: string): boolean {
    const validStatuses = [
        BookingStatus.CONFIRMED,
        BookingStatus.PAID,
        BookingStatus.OWNER,
        BookingStatus.UNPAID
    ] as string[];
    
    return validStatuses.includes(status);
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

export function calculateCleaningEffort(areaM2: number): CleaningEffort {
    if (areaM2 < 40) {
        return { teamSize: 1, estimatedMinutes: 60 };
    }
    
    if (areaM2 < 70) {
        return { teamSize: 1, estimatedMinutes: 90 };
    }
    
    if (areaM2 < 90) {
        return { teamSize: 2, estimatedMinutes: 120 };
    }
    
    if (areaM2 < 120) { 
        return { teamSize: 2, estimatedMinutes: 150 };
    }

    return { teamSize: 2, estimatedMinutes: 180 };
}