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
