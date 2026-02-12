import { ScaleRepository } from "../../../../repositories/scale/scaleRepository";
import { GenerateReport } from "./../../../../utils/generateReport";
import { Env } from "../../../../types/configTypes";

export class ReportService {
    private scheduleRepo: ScaleRepository;
    private generateReport: GenerateReport;

    constructor(env: Env) {
        this.scheduleRepo = new ScaleRepository(env.DB);
        this.generateReport = new GenerateReport();
    }
    
    async getScaleReportFile(runId: number): Promise<Uint8Array | null> {

        const tasks = await this.scheduleRepo.getScheduleItems(runId);

        if (!tasks || tasks.length === 0) {
            return null;
        }

        const base64 = this.generateReport.generateScheduleReport(`Escala #${runId}`, tasks);

        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        return bytes;
    }
}