import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Env } from "../../types/configTypes";
import { PrioritizeService } from "../../services/prioritizeService";

export class GeneratePriority extends OpenAPIRoute { 
    schema = {
            tags: ["Scales"],
            summary: "Debug: Gerar e Visualizar Prioridade",
            description: "Gera a lista de tarefas de limpeza do dia e retorna ela ordenada por prioridade, sem salvar no banco.",
            request: {
                query: z.object({
                    date: z.string().date().optional().describe("Data específica (YYYY-MM-DD). Se vazio, usa HOJE."),
                }),
            },
            responses: {
                "200": {
                    description: "Lista Priorizada",
                    content: {
                        "application/json": {
                            schema: z.object({
                                status: z.string(),
                                count: z.number(),
                                tasks: z.array(z.object({
                                    priorityScore: z.number().optional(), 
                                    accommodationName: z.string(),
                                    zone: z.string(),
                                    isTurnover: z.boolean(),
                                    checkInDate: z.string().nullable(),
                                    checkOutDate: z.string().nullable(),
                                    areaM2: z.number(),
                                    effort: z.object({
                                        teamSize: z.number(),
                                        estimatedMinutes: z.number()
                                    }),
                                    address: z.string()
                                })),
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

    async handle(c) {

        const data = await this.getValidatedData<typeof this.schema>();

        const today = new Date().toISOString().split("T")[0];

        const targetDate = data.query.date || today;

        try {
            const prioritizeService = new PrioritizeService(c.env as Env);

            const result = await prioritizeService.generatePriority(targetDate);

            return c.json({
                status: "success",
                count: result.items.length,
                tasks: result.items
            }, 200);

        } catch (error: any) {
            console.error(error);
            return c.json({ status: "error", message: error.message }, 500);
        }
    }
}