import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { Env } from "../../types/configTypes";
import { OffDayService } from "../../services/cleaner/offDayService";

export class GetOffDayBatch extends OpenAPIRoute {
    schema = {
        tags: ["Cleaners"],
        summary: "Consultar Folgas Mensais",
        description: "Lista todas as folgas cadastradas para um determinado mês.",
        request: {
            query: z.object({
                month: z.string().regex(/^\d{4}-\d{2}$/, "Formato YYYY-MM").describe("Mês de referência (ex: 2025-12)")
            }),
        },
        responses: {
            "200": {
                description: "Lista de folgas",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            month: z.string(),
                            count: z.number(),
                            offDays: z.array(z.object({
                                cleanerId: z.number(),
                                cleanerName: z.string(),
                                date: z.string(),
                                reason: z.string().nullable()
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
            const results = await service.getMonthlyOffDays(data.query.month);
            
            return c.json({ 
                success: true, 
                month: data.query.month,
                count: results.length,
                offDays: results
            }, 200);
        } catch (e: any) {
            return c.json({ success: false, error: e.message }, 500);
        }
    }
}