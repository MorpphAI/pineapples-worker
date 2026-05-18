export interface Cleaner {
    id: number;
    name: string;
    zones: string;
    shift_start: string;
    shift_end: string;
    is_active: number;
    phone?: string | null;
    created_at: string;
    fixed_accommodations?: string | null;
    is_fixed: number;
}

export interface NewCleaner {
    name: string;
    zones: string;
    shift_start: string;
    shift_end: string;
    phone?: string | null;
    fixed_accommodations?: string | null;
    is_fixed: boolean;
    is_active?: boolean;
}

export interface CleaningEffort {
    effortUnits: 1 | 2 | 3;
    estimatedMinutes: number;
    requiredPeople: 1 | 2 | 3;
    sizeClass: "SMALL" | "MEDIUM" | "LARGE" | "CUSTOM";
}

export interface CleaningProfileOverride {
    accommodationId?: string;
    accommodationName: string;
    effortUnits?: 1 | 2 | 3;
    estimatedMinutes?: number;
    requiredPeople?: 1 | 2 | 3;
    zoneOverride?: string;
    addressGroupKeyOverride?: string;
    isActive?: boolean;
    notes?: string;
}

export type BookingOccupantType = "GUEST" | "OWNER";

export type CleaningRequirement =
    | "GUEST_TURNOVER"
    | "GUEST_CHECKOUT_ONLY"
    | "OWNER_CHECKOUT"
    | "OWNER_EXTENSION"
    | "OWNER_TO_GUEST"
    | "GUEST_TO_OWNER"
    | "NO_CLEANING";

export interface CleaningTask {
    cleanerName?: string;
    startTime?: string;
    endTime?: string;
    bookingOutId?: string | null;
    bookingInId?: string | null;
    bookingId?: string;
    accommodationId: string;
    accommodationName: string;
    zone: string;
    checkInDate: string | null;
    checkOutDate: string | null;
    isTurnover: boolean;
    cleaningRequirement?: CleaningRequirement;
    stayDuration: number | null;
    areaM2: number;
    effort: CleaningEffort;
    priorityScore?: number;
    deadlineMinutes?: number;
    address: string;
    addressGroupKey?: string;
    latitude?: number | null;
    longitude?: number | null;
}

export interface CleaningBundle {
    id: string;
    date: string;
    zone: string;
    addressGroupKey: string;
    addressDisplay: string;
    tasks: CleaningTask[];
    totalEffortUnits: number;
    totalMinutes: number;
    requiredPeople: 1 | 2 | 3;
    deadlineMinutes: number;
    priorityScore: number;
    cleanerName?: string;
    startTime?: string;
    endTime?: string;
    latitude?: number | null;
    longitude?: number | null;
}

export interface ScaleSummary {
    totalApartments: number;
    totalBundles: number;
    availableCleaners: number;
    cleanersOff: number;
    extraCleanersNeeded: number;
    extraCleanersByZone: Record<string, number>;
    unallocatedCount: number;
    warnings: string[];
}

export interface GenerateScheduleOptions {
    cleaningProfiles?: CleaningProfileOverride[];
}

export interface CleanerState extends Cleaner {
    currentAvailableMinutes: number;
    shiftEndMinutes: number;
    tasksCount: number;
    lunchBreakTaken: boolean;
    lastLatitude?: number | null;
    lastLongitude?: number | null;
    isVirtual?: boolean;
}

export interface OffDayScheduleInput {
    month: string;
    schedules: {
        cleanerId: number;
        offDays: string[];
        reason?: string;
    }[];
}

export interface OffDayResult {
    id: number;
    cleanerId: number;
    cleanerName: string;
    date: string;
    reason: string | null;
}

export interface UpdateCleanerFields {
    name?: string;
    zones?: string;
    shift_start?: string;
    shift_end?: string;
    phone?: string | null;
    fixed_accommodations?: string | null;
    is_fixed?: boolean;
    is_active?: boolean;
}

export interface CleanerScheduleView {
    cleanerName: string;
    tasks: {
        timeRange: string;
        accommodation: string;
        type: string;
        address: string;
        zone: string;
    }[];
}
