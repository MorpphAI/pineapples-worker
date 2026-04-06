import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { Env } from "../../../../types/configTypes";
import { GetCleanerByIdService } from "../../../../services/v1/cleaner/getCleanerById/getCleanerByIdService";

export class GetCleanerById extends OpenAPIRoute {
    schema = {
        tags: ["Cleaners"],
        summary: "Buscar faxineira por ID",
        description: "Retorna os dados de uma faxineira específica pelo ID.",
        request: {
            params: z.object({
                id: z.string().describe("ID da faxineira"),
            }),
        },
        responses: {
            "200": {
                description: "Faxineira encontrada",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            cleaner: z.object({
                                id: z.number(),
                                name: z.string(),
                                zones: z.string(),
                                shift_start: z.string(),
                                shift_end: z.string(),
                                is_active: z.number(),
                                is_fixed: z.number(),
                                fixed_accommodations: z.string().nullable(),
                                created_at: z.string(),
                            }),
                        }),
                    },
                },
            },
            "400": {
                description: "ID inválido",
                content: { "application/json": { schema: z.object({ success: z.boolean(), error: z.string() }) } },
            },
            "404": {
                description: "Faxineira não encontrada",
                content: { "application/json": { schema: z.object({ success: z.boolean(), error: z.string() }) } },
            },
            "500": {
                description: "Erro interno",
                content: { "application/json": { schema: z.object({ success: z.boolean(), error: z.string() }) } },
            },
        },
    };

    async handle(c: Context<{ Bindings: Env }>) {
        const { id } = c.req.param();
        const parsedId = parseInt(id, 10);

        if (isNaN(parsedId)) {
            return c.json({ success: false, error: "ID inválido." }, 400);
        }

        const service = new GetCleanerByIdService(c.env);

        try {
            const cleaner = await service.getById(parsedId);

            if (!cleaner) {
                return c.json({ success: false, error: "Faxineira não encontrada." }, 404);
            }

            return c.json({ success: true, cleaner }, 200);
        } catch (e: any) {
            console.error(e);
            return c.json({ success: false, error: e.message }, 500);
        }
    }
}
