import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { Env } from "../../types/configTypes";
import { OffDayService } from "../../services/cleaner/offDayService";

export class CreateOffDayBatch extends OpenAPIRoute {
    schema = {
        tags: ["Cleaners"],
        summary: "Cadastrar Folgas Mensais",
        description: "Recebe a escala de folgas do mês para toda a equipe. ATENÇÃO: Substitui qualquer folga já lançada para este mês.",
        request: {
            body: {
                content: {
                    "application/json": {
                        schema: z.object({
                            month: z.string().regex(/^\d{4}-\d{2}$/, "Formato YYYY-MM").describe("Mês de referência (ex: 2025-12)"),
                            schedules: z.array(z.object({
                                cleanerId: z.number(),
                                offDays: z.array(z.string().date()).describe("Lista de datas YYYY-MM-DD"),
                                reason: z.string().optional().default("Folga Escala")
                            })).min(1)
                        }),
                    },
                },
            },
        },
        responses: {
            "201": {
                description: "Escala salva com sucesso",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            message: z.string()
                        }),
                    },
                },
            },
            "500": {
                description: "Erro interno",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            error: z.string()
                        })
                    }
                }
            }
        },
    };

    async handle(c: Context<{ Bindings: Env }>) {
        const data = await this.getValidatedData<typeof this.schema>();
        const service = new OffDayService(c.env);

        try {
            await service.registerMonthlyOffDays(data.body);
            
            return c.json({ 
                success: true, 
                message: `Escala de folgas para ${data.body.month} atualizada com sucesso.` 
            }, 201);
        } catch (e: any) {
            return c.json({ success: false, error: e.message }, 500);
        }
    }
}