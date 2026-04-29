import { CleaningEffort } from "../../types/cleanerTypes";

export function calculateCleaningEffort(
    areaM2: number,
    stayDurationDays?: number | null
): CleaningEffort {
    let effortUnits: 1 | 2 | 3;
    let baseMinutes: number;
    let sizeClass: CleaningEffort["sizeClass"];

    if (areaM2 < 40) {
        effortUnits = 1;
        baseMinutes = 60;
        sizeClass = "SMALL";
    } else if (areaM2 < 70) {
        effortUnits = 2;
        baseMinutes = 90;
        sizeClass = "MEDIUM";
    } else {
        effortUnits = 3;
        if (areaM2 < 90) {
            baseMinutes = 120;
        } else if (areaM2 < 120) {
            baseMinutes = 150;
        } else {
            baseMinutes = 180;
        }
        sizeClass = "LARGE";
    }

    let extraMinutes = 0;
    if (stayDurationDays != null && stayDurationDays > 4) {
        const extraDays = stayDurationDays - 4;
        const blocks = Math.ceil(extraDays / 4);
        extraMinutes = blocks * 30;
    }

    return {
        effortUnits,
        estimatedMinutes: baseMinutes + extraMinutes,
        requiredPeople: 1,
        sizeClass,
    };
}
