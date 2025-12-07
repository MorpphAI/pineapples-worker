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