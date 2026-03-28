import * as XLSX from "xlsx";
import { CleaningTask } from "../types/cleanerTypes";

export class GenerateReport {

    generateScheduleReport(date: string, tasks: CleaningTask[]): string {
        const zonas = [...new Set(tasks.map(t => t.zone))].sort();

        const workbook = XLSX.utils.book_new();

        const geralSheet = XLSX.utils.json_to_sheet(this.buildSheetData(tasks));
        geralSheet['!cols'] = this.columnWidths;
        XLSX.utils.book_append_sheet(workbook, geralSheet, "Geral");

        for (const zona of zonas) {
            const zonaSheet = XLSX.utils.json_to_sheet(this.buildSheetData(tasks.filter(t => t.zone === zona)));
            zonaSheet['!cols'] = this.columnWidths;
            XLSX.utils.book_append_sheet(workbook, zonaSheet, zona);
        }

        return XLSX.write(workbook, { bookType: "xlsx", type: "base64" });
    }

    private buildSheetData(tasks: CleaningTask[]) {
        return tasks.map(task => ({
            "Zona": task.zone,
            "Código Acomodação avantio": task.accommodationId ? String(task.accommodationId) : '--',
            "Código Imóvel": task.accommodationName,
            "Tipo": task.isTurnover ? "OUT-IN" : (task.checkInDate ? "CHECK-IN" : "CHECK-OUT"),
            "Profissional": task.cleanerName || "NÃO ALOCADO",
            "Início": task.startTime || "--:--",
            "Fim": task.endTime || "--:--",
            "Estadia (dias)": task.stayDuration !== null && task.stayDuration !== undefined ? task.stayDuration : "--",
            "Endereço": task.address,
            "Prioridade": this.getPriorityLabel(task)
        }));
    }

    private readonly columnWidths = [
        { wch: 10 },
        { wch: 25 },
        { wch: 20 },
        { wch: 20 },
        { wch: 10 },
        { wch: 10 },
        { wch: 15 },
        { wch: 40 },
        { wch: 15 },
        { wch: 15 }
    ];

    private getPriorityLabel(task: CleaningTask): string {
        if (task.isTurnover) return "ALTA (Turnover)";
        if (task.checkInDate) return "MÉDIA (Check-in)";
        return "NORMAL (Saída)";
    }
}
