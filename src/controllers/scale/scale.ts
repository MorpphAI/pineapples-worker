import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Env } from "../../types/configTypes";
import { ScheduleService } from "../../services/scale/scaleService"; 
import { Context } from "hono"; 

export class CreateScales extends OpenAPIRoute { 
    schema = {
            tags: ["Scales"],
            summary: "Gerar Escala de Limpeza Diária",
            description: "Processa check-ins, check-outs e equipe disponível para gerar e salvar a escala do dia.",
            request: {
                query: z.object({
                    date: z.string().date().optional().describe("Data específica (YYYY-MM-DD). Se vazio, usa HOJE."),
                }),
            },
            responses: {
                "201": {
                    description: "Escala gerada com sucesso",
                    content: {
                        "application/json": {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                                runId: z.number().describe("ID do lote gerado no banco"),
                                totalTasks: z.number(),
                                preview: z.array(z.object({
                                    accommodation: z.string(),
                                    zone: z.string(),
                                    cleaner: z.string().nullable(),
                                    type: z.string()
                                }))
                            }),
                        },
                    },
                },
                "500": {
                    description: "Erro interno",
                    content: {
                        "application/json": {
                            schema: z.object({
                                status: z.string(),
                                message: z.string()
                            })
                        }
                    }
                }
            },
    };

    async handle(c: Context<{ Bindings: Env }>) {

        const data = await this.getValidatedData<typeof this.schema>();

        const today = new Date().toISOString().split("T")[0];

        const targetDate = data.query.date || today;

        try {
            const scheduleService = new ScheduleService(c.env as Env);

            const result = await scheduleService.generateDailySchedule(targetDate);

            return c.json({
                success: true,
                message: `Escala gerada para o dia ${targetDate}`,
                runId: result.runId,
                totalTasks: result.items.length,
                preview: result.items.map(item => ({
                    accommodation: item.accommodationId, 
                    zone: item.zone,
                    cleaner: item.accommodationName,
                    type: item.isTurnover ? "TURNOVER" : "SIMPLE"
                }))
            }, 201); 

        } catch (error: any) {
            console.error(error);
            return c.json({ status: "error", message: error.message }, 500);
        }
    }
}