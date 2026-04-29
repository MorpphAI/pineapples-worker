import { AvantioAccommodation } from "../../types/avantioTypes";
import { CleaningBundle, CleaningTask } from "../../types/cleanerTypes";
import { getDeadlineMinutes } from "./timeParsing";
import { normalizeKey } from "./zoneMatching";

export function buildAddressGroupKey(accommodation: AvantioAccommodation): string {
    return [
        accommodation.location?.addrType,
        accommodation.location?.address,
        accommodation.location?.number,
        accommodation.location?.cityName,
    ]
        .filter(Boolean)
        .map(String)
        .map(normalizeKey)
        .join("|");
}

export function buildCleaningBundles(tasks: CleaningTask[], date: string): CleaningBundle[] {
    const groups = new Map<string, CleaningTask[]>();
    for (const task of tasks) {
        const deadline = task.deadlineMinutes ?? getDeadlineMinutes(task.cleaningRequirement ?? "GUEST_CHECKOUT_ONLY");
        const key = [
            date,
            normalizeKey(task.zone),
            task.addressGroupKey || normalizeKey(task.address),
            deadline,
        ].join("::");
        groups.set(key, [...(groups.get(key) || []), { ...task, deadlineMinutes: deadline }]);
    }

    const bundles: CleaningBundle[] = [];
    let sequence = 1;

    for (const groupTasks of groups.values()) {
        const sorted = groupTasks.slice().sort((a, b) => {
            const diff = b.effort.effortUnits - a.effort.effortUnits;
            if (diff !== 0) return diff;
            return a.accommodationName.localeCompare(b.accommodationName);
        });
        const bins: CleaningTask[][] = [];

        for (const task of sorted) {
            let placed = false;
            for (const bin of bins) {
                const units = bin.reduce((sum, item) => sum + item.effort.effortUnits, 0);
                if (units + task.effort.effortUnits <= 3) {
                    bin.push(task);
                    placed = true;
                    break;
                }
            }
            if (!placed) bins.push([task]);
        }

        for (const bin of bins) {
            const first = bin[0];
            bundles.push({
                id: `bundle-${date}-${sequence++}`,
                date,
                zone: first.zone,
                addressGroupKey: first.addressGroupKey || normalizeKey(first.address),
                addressDisplay: first.address,
                tasks: bin,
                totalEffortUnits: bin.reduce((sum, item) => sum + item.effort.effortUnits, 0),
                totalMinutes: bin.reduce((sum, item) => sum + item.effort.estimatedMinutes, 0),
                requiredPeople: Math.max(...bin.map(item => item.effort.requiredPeople)) as 1 | 2 | 3,
                deadlineMinutes: Math.min(...bin.map(item => item.deadlineMinutes ?? getDeadlineMinutes(item.cleaningRequirement ?? "GUEST_CHECKOUT_ONLY"))),
                priorityScore: Math.max(...bin.map(item => item.priorityScore ?? 0)),
                latitude: first.latitude,
                longitude: first.longitude,
            });
        }
    }

    return bundles.sort((a, b) => {
        const diff = b.priorityScore - a.priorityScore;
        if (diff !== 0) return diff;
        return a.id.localeCompare(b.id);
    });
}
