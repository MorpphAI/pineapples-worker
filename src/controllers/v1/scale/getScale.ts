import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { Env } from "../../../types/configTypes";
import { GetScaleViewService } from "../../../services/v1/scale/GetScale/getScale";

export class GetScaleView extends OpenAPIRoute {
    schema = {
        tags: ["Scales"],
        summary: "Visualizar Escala do Dia",
        description: "Retorna a lista de tarefas agrupada por faxineira para visualização operacional.",
        request: {
            query: z.object({
                date: z.string().date().optional().describe("Data da escala (YYYY-MM-DD). Se vazio, usa HOJE."),
            }),
        },
        responses: {
            "200": {
                description: "Escala encontrada",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            date: z.string(),
                            count: z.number(),
                            schedule: z.array(z.object({
                                cleanerName: z.string(),
                                tasks: z.array(z.object({
                                    timeRange: z.string(),
                                    accommodation: z.string(),
                                    type: z.string(),
                                    address: z.string(),
                                    zone: z.string()
                                }))
                            }))
                        }),
                    },
                },
            },
            "404": {
                description: "Nenhuma escala encontrada para esta data"
            }
        },
    };

    async handle(c: Context<{ Bindings: Env }>) {
        
        const data = await this.getValidatedData<typeof this.schema>();

        const today = new Date().toISOString().split("T")[0];

        const targetDate = data.query.date || today;

        try {

            const service = new GetScaleViewService(c.env);

            const view = await service.getCleanerDailyView(targetDate);

            if (view.length === 0) {
                return c.json({ 
                    success: false, 
                    message: "Nenhuma escala encontrada para esta data. Gere a escala primeiro (POST /scale)." 
                }, 404);
            }

            return c.json({
                success: true,
                date: targetDate,
                count: view.length, 
                schedule: view
            }, 200);

        } catch (error: any) {
            console.error("[GetScaleView] Erro:", error);
            return c.json({ success: false, error: error.message }, 500);
        }
    }
}