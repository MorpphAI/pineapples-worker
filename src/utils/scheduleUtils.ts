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

export function timeToMinutes(time: string): number {
    if (!time) return 0;
    const [h, m] = time.split(':').map(Number);
    return (h * 60) + m;
}

export function minutesToTime(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}