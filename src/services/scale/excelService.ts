import * as XLSX from "xlsx";
import { CleaningTask } from "../../types/cleanerTypes";

export class ExcelService {
    
    /**
     * Gera o arquivo Excel da escala e retorna como string Base64.
     * Isso facilita o envio via JSON na API.
     */
    generateScheduleReport(date: string, tasks: CleaningTask[]): string {
        // 1. Preparar os dados para o formato de linhas do Excel
        // Mapeamos o objeto técnico para o objeto de "Apresentação"
        const reportData = tasks.map(task => ({
            "Zona": task.zone,
            "Código Imóvel": task.accommodationName, // Ou accommodationId se preferir
            "Tipo": task.isTurnover ? "TURNOVER (Sai/Entra)" : (task.checkInDate ? "CHECK-IN" : "CHECK-OUT"),
            "Profissional": task.cleanerName || "NÃO ALOCADO",
            "Início": task.startTime || "--:--",
            "Fim": task.endTime || "--:--",
            "Endereço": task.address,
            "Prioridade": this.getPriorityLabel(task),
            "Equipe Necessária": task.effort.teamSize === 2 ? "Dupla" : "Individual"
        }));

        // 2. Criar a Planilha (Worksheet)
        const worksheet = XLSX.utils.json_to_sheet(reportData);

        // 3. Ajustar larguras das colunas (Cosmético opcional, mas bom)
        const columnWidths = [
            { wch: 10 }, // Zona
            { wch: 25 }, // Código Imóvel
            { wch: 20 }, // Tipo
            { wch: 20 }, // Profissional
            { wch: 10 }, // Início
            { wch: 10 }, // Fim
            { wch: 40 }, // Endereço
            { wch: 15 }, // Prioridade
            { wch: 15 }  // Equipe
        ];
        worksheet['!cols'] = columnWidths;

        // 4. Criar o Livro (Workbook) e adicionar a planilha
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Escala do Dia");

        // 5. Gerar o binário em Base64
        // Usamos base64 para poder trafegar dentro do JSON de resposta da API
        const excelBase64 = XLSX.write(workbook, { bookType: "xlsx", type: "base64" });

        return excelBase64;
    }

    // Helper simples para deixar o relatório mais legível
    private getPriorityLabel(task: CleaningTask): string {
        if (task.isTurnover) return "ALTA (Turnover)";
        if (task.checkInDate) return "MÉDIA (Check-in)";
        return "NORMAL (Saída)";
    }
}