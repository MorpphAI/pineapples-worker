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

export function calculateCleaningEffort(
    areaM2: number,
    stayDurationDays?: number | null
): CleaningEffort {
    // Tabela base por metragem
    let baseTeam: 1 | 2 | 3;
    let baseMinutes: number;

    if (areaM2 < 40) {
        baseTeam = 1; baseMinutes = 60;
    } else if (areaM2 < 70) {
        baseTeam = 1; baseMinutes = 90;
    } else if (areaM2 < 90) {
        baseTeam = 2; baseMinutes = 120;
    } else if (areaM2 < 120) {
        baseTeam = 2; baseMinutes = 150;
    } else {
        baseTeam = 2; baseMinutes = 180;
    }

    // Acréscimo por estadia longa (> 4 dias)
    // Cada bloco de 4 dias extras adiciona 30 min:
    //   5-8 dias → 1 bloco = +30 min
    //   9-12 dias → 2 blocos = +60 min
    let extraMinutes = 0;
    if (stayDurationDays != null && stayDurationDays > 4) {
        const extraDays = stayDurationDays - 4;
        const blocks = Math.ceil(extraDays / 4);
        extraMinutes = blocks * 30;
    }

    // Upgrade para equipe de 3: imóvel grande com estadia muito longa
    if (stayDurationDays != null && stayDurationDays > 7 && areaM2 >= 90) {
        baseTeam = 3;
    }

    return {
        teamSize: baseTeam,
        estimatedMinutes: baseMinutes + extraMinutes,
    };
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

/**
 * Calcula distância em km entre dois pontos usando a fórmula de Haversine.
 */
export function haversineDistanceKm(
    lat1: number, lon1: number,
    lat2: number, lon2: number
): number {
    const R = 6371; // raio da Terra em km
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Estima minutos de deslocamento com base na distância.
 * Velocidade média de 15 km/h (trânsito + caminhada urbana).
 * BASE_MINUTES é overhead fixo sempre somado (não um mínimo).
 */
export function travelMinutesByDistance(distanceKm: number): number {
    const AVG_SPEED_KMH = 15;
    const BASE_MINUTES = 5;
    return Math.ceil(BASE_MINUTES + (distanceKm / AVG_SPEED_KMH) * 60);
}
