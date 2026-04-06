import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { Env } from "../../../../types/configTypes";
import { GetScaleHistoryService } from "../../../../services/v1/scale/getScaleHistory/getScaleHistoryService";

export class GetScaleHistory extends OpenAPIRoute {
    schema = {
        tags: ["Scales"],
        summary: "Histórico de escalas",
        description: "Retorna todas as escalas geradas, ordenadas da mais recente para a mais antiga.",
        responses: {
            "200": {
                description: "Histórico retornado com sucesso",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            count: z.number(),
                            runs: z.array(z.object({
                                id: z.number(),
                                target_date: z.string(),
                                status: z.string(),
                                created_at: z.string(),
                                item_count: z.number(),
                            })),
                        }),
                    },
                },
            },
            "500": {
                description: "Erro interno",
                content: { "application/json": { schema: z.object({ success: z.boolean(), error: z.string() }) } },
            },
        },
    };

    async handle(c: Context<{ Bindings: Env }>) {
        const service = new GetScaleHistoryService(c.env);

        try {
            const runs = await service.getHistory();
            return c.json({ success: true, count: runs.length, runs }, 200);
        } catch (e: any) {
            console.error(e);
            return c.json({ success: false, error: e.message }, 500);
        }
    }
}
