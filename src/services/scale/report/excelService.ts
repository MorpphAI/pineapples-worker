import * as XLSX from "xlsx";
import { CleaningTask } from "../../../types/cleanerTypes";

export class ExcelService {
    
    generateScheduleReport(date: string, tasks: CleaningTask[]): string {
        const reportData = tasks.map(task => ({
            "Zona": task.zone,
            "Código Imóvel": task.accommodationName,
            "Tipo": task.isTurnover ? "TURNOVER (Sai/Entra)" : (task.checkInDate ? "CHECK-IN" : "CHECK-OUT"),
            "Profissional": task.cleanerName || "NÃO ALOCADO",
            "Início": task.startTime || "--:--",
            "Fim": task.endTime || "--:--",
            "Endereço": task.address,
            "Prioridade": this.getPriorityLabel(task)
        }));

        const worksheet = XLSX.utils.json_to_sheet(reportData);

        const columnWidths = [
            { wch: 10 },
            { wch: 25 },
            { wch: 20 },
            { wch: 20 },
            { wch: 10 },
            { wch: 10 },
            { wch: 40 },
            { wch: 15 },
            { wch: 15 } 
        ];
        worksheet['!cols'] = columnWidths;

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Escala do Dia");

        const excelBase64 = XLSX.write(workbook, { bookType: "xlsx", type: "base64" });

        return excelBase64;
    }

    private getPriorityLabel(task: CleaningTask): string {
        if (task.isTurnover) return "ALTA (Turnover)";
        if (task.checkInDate) return "MÉDIA (Check-in)";
        return "NORMAL (Saída)";
    }
}