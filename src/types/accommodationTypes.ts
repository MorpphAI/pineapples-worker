import { CleaningEffort } from "./cleanerTypes";

export type AccommodationRow = {
    accommodation_id: string;
    name: string;
    status: string | null;
    area_m2: number | null;
    addr_type: string | null;
    address: string | null;
    number: string | null;
    door: string | null;
    city_name: string | null;
    latitude: number | null;
    longitude: number | null;
    last_seen_at: string;
    created_at: string;
    updated_at: string;
};

export type AccommodationCleaningOverrideRow = {
    accommodation_id: string;
    effort_units: number | null;
    estimated_minutes: number | null;
    required_people: number | null;
    zone_override: string | null;
    address_group_key_override: string | null;
    is_active: number;
    notes: string | null;
    updated_by: string | null;
    created_at: string;
    updated_at: string;
};

export type AccommodationCleaningOverrideInput = {
    effortUnits?: 1 | 2 | 3 | null;
    estimatedMinutes?: number | null;
    requiredPeople?: 1 | 2 | 3 | null;
    zoneOverride?: string | null;
    addressGroupKeyOverride?: string | null;
    isActive?: boolean;
    notes?: string | null;
    updatedBy?: string | null;
};

export type AccommodationCleaningView = {
    accommodationId: string;
    name: string;
    status: string | null;
    address: string;
    areaM2: number | null;
    lastSeenAt: string;
    suggested: {
        zone: string | null;
        addressGroupKey: string;
        effortUnits: 1 | 2 | 3;
        estimatedMinutes: number;
        requiredPeople: 1;
        sizeClass: CleaningEffort["sizeClass"];
    };
    override: {
        effortUnits?: 1 | 2 | 3;
        estimatedMinutes?: number;
        requiredPeople?: 1 | 2 | 3;
        zoneOverride?: string;
        addressGroupKeyOverride?: string;
        isActive: boolean;
        notes?: string;
    } | null;
    effective: {
        zone: string | null;
        addressGroupKey: string;
        effortUnits: 1 | 2 | 3;
        estimatedMinutes: number;
        requiredPeople: 1 | 2 | 3;
    };
    flags: {
        hasOverride: boolean;
        missingArea: boolean;
        missingZone: boolean;
        largeWithoutReview: boolean;
    };
};

export type AccommodationFilters = {
    q?: string;
    zone?: string;
    hasOverride?: "true" | "false";
    flags?: "missingArea" | "missingZone" | "largeWithoutReview";
    status?: string;
};
