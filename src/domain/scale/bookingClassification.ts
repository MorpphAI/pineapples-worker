import { AvantioBooking, BookingStatus } from "../../types/avantioTypes";
import { BookingOccupantType, CleaningRequirement } from "../../types/cleanerTypes";

export function getBookingOccupantType(booking?: AvantioBooking | null): BookingOccupantType | null {
    if (!booking) return null;
    return booking.status === BookingStatus.OWNER ? "OWNER" : "GUEST";
}

export function classifyCleaningRequirement(
    checkout?: AvantioBooking | null,
    checkin?: AvantioBooking | null
): CleaningRequirement {
    const outType = getBookingOccupantType(checkout);
    const inType = getBookingOccupantType(checkin);

    if (outType === "GUEST" && inType === "GUEST") return "GUEST_TURNOVER";
    if (outType === "OWNER" && inType === "OWNER") return "OWNER_EXTENSION";
    if (outType === "OWNER" && inType === "GUEST") return "OWNER_TO_GUEST";
    if (outType === "GUEST" && inType === "OWNER") return "GUEST_TO_OWNER";
    if (outType === "GUEST") return "GUEST_CHECKOUT_ONLY";
    if (outType === "OWNER") return "OWNER_CHECKOUT";
    return "NO_CLEANING";
}

export function cleaningIsRequired(requirement: CleaningRequirement): boolean {
    return requirement !== "OWNER_EXTENSION" && requirement !== "NO_CLEANING";
}

export function isSameDayTurnover(requirement: CleaningRequirement): boolean {
    return requirement === "GUEST_TURNOVER" || requirement === "OWNER_TO_GUEST" || requirement === "GUEST_TO_OWNER";
}
