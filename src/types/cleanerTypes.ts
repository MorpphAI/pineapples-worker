export interface Cleaner {
    id: number;
    name: string;
    zones: string;
    shift_start: string;
    shift_end: string;
    is_active: number; 
    created_at: string;
}

export type NewCleaner = Omit<Cleaner, "id" | "is_active" | "created_at">;

export interface CleaningEffort {
    teamSize: 1 | 2;
    estimatedMinutes: number;
}

export interface CleaningTask {
    accommodationId: string;
    accommodationName: string;
    zone: string;
    checkInTime: string | null;
    checkOutTime: string | null; 
    isTurnover: boolean;
    areaM2: number;
    effort: CleaningEffort;
    priorityScore?: number;
    address: string;
}