import { OffDayRepository } from "../../../../repositories/cleaner/offDayRepository";
import { Env } from "../../../../types/configTypes";

export class GetOffDaysService {
    private repo: OffDayRepository;

    constructor(env: Env) {
        this.repo = new OffDayRepository(env.DB);
    }

    async getMonthlyOffDays(month: string) {
        if (!/^\d{4}-\d{2}$/.test(month)) {
            throw new Error("Formato de mês inválido. Use YYYY-MM.");
        }
        return this.repo.getOffDaysByMonth(month);
    }
}