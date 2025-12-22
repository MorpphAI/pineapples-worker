import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Env } from "../../../types/configTypes";
import { ScaleService } from "../../../services/v1/scale/createScale/PostScaleService"; 
import { Context } from "hono"; 

export class CreateScales extends OpenAPIRoute { 
   schema = {
           tags: ["Scales"],
            summary: "Gerar Escala de Limpeza Diária",
            description: "Gera a escala e retorna o ID e o Link para download.",
            request: {
                query: z.object({
                    date: z.string().date().optional(),
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
                                runId: z.number(),
                                totalTasks: z.number(),
                                downloadUrl: z.string().describe("Link direto para baixar o Excel")
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
            const scaleService = new ScaleService(c.env);

            const result = await scaleService.generateDailySchedule(targetDate);

            const url = new URL(c.req.url);

            const downloadLink = `${url.origin}/v1/scale/${result.runId}/export`

            return c.json({
                success: true,
                message: `Escala gerada para o dia ${targetDate}`,
                runId: result.runId,
                totalTasks: result.items.length,
                downloadUrl: downloadLink
            }, 201);
        } catch (error: any) {
            console.error(error);
            return c.json({ status: "error", message: error.message }, 500);
        }
    }
}