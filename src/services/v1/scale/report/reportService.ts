import { ScaleRepository } from "../../../../repositories/scale/scaleRepository";
import { ExcelService } from "./excelService";
import { Env } from "../../../../types/configTypes";

export class ReportService {
    private scheduleRepo: ScaleRepository;
    private excelService: ExcelService;

    constructor(env: Env) {
        this.scheduleRepo = new ScaleRepository(env.DB);
        this.excelService = new ExcelService();
    }
    
    async getScaleReportFile(runId: number): Promise<Uint8Array | null> {

        const tasks = await this.scheduleRepo.getScheduleItems(runId);

        if (!tasks || tasks.length === 0) {
            return null;
        }

        const base64 = this.excelService.generateScheduleReport(`Escala #${runId}`, tasks);

        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        return bytes;
    }
}