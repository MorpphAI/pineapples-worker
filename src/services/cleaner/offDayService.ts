import { OffDayRepository } from "../../repositories/cleaner/offDayRepository";
import { Env } from "../../types/configTypes";
import { OffDayScheduleInput } from "../../types/cleanerTypes";

export class OffDayService {
    private repo: OffDayRepository;

    constructor(env: Env) {
        this.repo = new OffDayRepository(env.DB);
    }

    async registerMonthlyOffDays(data: OffDayScheduleInput) {

        if (!/^\d{4}-\d{2}$/.test(data.month)) {
            throw new Error("Formato de mês inválido. Use YYYY-MM.");
        }

        return this.repo.saveMonthlySchedule(data);
    }
}