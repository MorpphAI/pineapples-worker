export interface Cleaner {
    id: number;
    name: string;
    zones: string;
    shift_start: string;
    shift_end: string;
    is_active: number; 
    created_at: string;
    fixed_accommodations?: string | null;
    is_fixed: number;
}

export type NewCleaner = Omit<Cleaner, "id" | "is_active" | "created_at">;

export interface CleaningEffort {
    teamSize: 1 | 2;
    estimatedMinutes: number;
}

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
    areaM2: number;
    effort: CleaningEffort;
    priorityScore?: number;
    address: string;
}

export interface CleanerState extends Cleaner {
    currentAvailableMinutes: number; 
    shiftEndMinutes: number;         
    tasksCount: number;              
}

export interface OffDayScheduleInput {
    month: string;
    schedules: {
        cleanerId: number;
        offDays: string[];
        reason?: string;
    }[];
}