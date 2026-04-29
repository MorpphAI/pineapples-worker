import { AvantioBooking } from "../../types/avantioTypes";
import { CleaningRequirement } from "../../types/cleanerTypes";
import { isSameDayTurnover } from "./bookingClassification";

export function parseTimeLike(value: unknown): number | null {
    if (typeof value !== "string" || !value.trim()) return null;
    const trimmed = value.trim();
    const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (timeMatch) {
        const hour = Number(timeMatch[1]);
        const minute = Number(timeMatch[2]);
        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return hour * 60 + minute;
    }

    const embeddedTimeMatch = trimmed.match(/T(\d{1,2}):(\d{2})/);
    if (embeddedTimeMatch) {
        const hour = Number(embeddedTimeMatch[1]);
        const minute = Number(embeddedTimeMatch[2]);
        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return hour * 60 + minute;
    }

    const date = new Date(trimmed);
    if (!Number.isNaN(date.getTime())) {
        return date.getUTCHours() * 60 + date.getUTCMinutes();
    }

    return null;
}

export function extractCheckInTimeMinutes(booking?: AvantioBooking | null): number | null {
    if (!booking) return null;
    const candidates = [
        booking.arrivalTime,
        booking.checkInTime,
        booking.expectedArrivalTime,
        booking.plannedArrivalTime,
    ];
    for (const candidate of candidates) {
        const parsed = parseTimeLike(candidate);
        if (parsed !== null) return parsed;
    }
    return null;
}

export function getDeadlineMinutes(requirement: CleaningRequirement, checkin?: AvantioBooking | null): number {
    const OUTIN_DEADLINE = 15 * 60;
    const CHECKOUT_DEADLINE = 17 * 60 + 50;
    const checkInTime = extractCheckInTimeMinutes(checkin);
    if (checkInTime !== null) return Math.max(checkInTime - 60, 11 * 60);
    return isSameDayTurnover(requirement) ? OUTIN_DEADLINE : CHECKOUT_DEADLINE;
}
