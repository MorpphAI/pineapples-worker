import { BookingStatus } from "../types/avantioTypes";

export {
    calculateCleaningEffort,
} from "../domain/scale/cleaningEffort";
export {
    applyCleaningProfile,
    findCleaningProfile,
    normalizeCleaningProfiles,
} from "../domain/scale/cleaningProfiles";
export {
    buildAddressGroupKey,
    buildCleaningBundles,
} from "../domain/scale/cleaningBundles";
export {
    cleanerCanWorkZone,
    extractZoneFromAccommodationName,
    normalizeKey,
} from "../domain/scale/zoneMatching";
export {
    cleaningIsRequired,
    classifyCleaningRequirement,
    getBookingOccupantType,
    isSameDayTurnover,
} from "../domain/scale/bookingClassification";
export {
    extractCheckInTimeMinutes,
    getDeadlineMinutes,
    parseTimeLike,
} from "../domain/scale/timeParsing";

export function isValidBookingStatus(status: string): boolean {
    const validStatuses = [
        BookingStatus.CONFIRMED,
        BookingStatus.PAID,
        BookingStatus.OWNER,
        BookingStatus.UNPAID
    ] as string[];

    return validStatuses.includes(status);
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

export function haversineDistanceKm(
    lat1: number, lon1: number,
    lat2: number, lon2: number
): number {
    const R = 6371;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

export function travelMinutesByDistance(distanceKm: number): number {
    const AVG_SPEED_KMH = 15;
    const BASE_MINUTES = 5;
    return Math.ceil(BASE_MINUTES + (distanceKm / AVG_SPEED_KMH) * 60);
}
