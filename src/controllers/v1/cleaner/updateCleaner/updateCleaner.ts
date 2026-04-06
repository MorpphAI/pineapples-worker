import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { Env } from "../../../../types/configTypes";
import { UpdateCleanerService } from "../../../../services/v1/cleaner/updateCleaner/updateCleanerService";

export class UpdateCleaner extends OpenAPIRoute {
    schema = {
        tags: ["Cleaners"],
        summary: "Atualizar faxineira",
        description: "Atualiza um ou mais campos de uma faxineira pelo ID. Todos os campos são opcionais.",
        request: {
            params: z.object({
                id: z.string().describe("ID da faxineira"),
            }),
            body: {
                content: {
                    "application/json": {
                        schema: z.object({
                            name: z.string().optional(),
                            zones: z.string().optional(),
                            shift_start: z.string().optional(),
                            shift_end: z.string().optional(),
                            fixed_accommodations: z.string().nullable().optional(),
                            is_fixed: z.boolean().optional(),
                            is_active: z.boolean().optional(),
                        }).refine(data => Object.keys(data).length > 0, {
                            message: "Pelo menos um campo deve ser fornecido."
                        }),
                    },
                },
            },
        },
        responses: {
            "200": {
                description: "Faxineira atualizada com sucesso",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            message: z.string(),
                        }),
                    },
                },
            },
            "400": {
                description: "ID inválido ou body vazio",
                content: {
                    "application/json": {
                        schema: z.object({ success: z.boolean(), error: z.string() }),
                    },
                },
            },
            "404": {
                description: "Faxineira não encontrada",
                content: {
                    "application/json": {
                        schema: z.object({ success: z.boolean(), error: z.string() }),
                    },
                },
            },
            "500": {
                description: "Erro interno",
                content: {
                    "application/json": {
                        schema: z.object({ success: z.boolean(), error: z.string() }),
                    },
                },
            },
        },
    };

    async handle(c: Context<{ Bindings: Env }>) {
        const { id } = c.req.param();
        const parsedId = parseInt(id, 10);

        if (isNaN(parsedId)) {
            return c.json({ success: false, error: "ID inválido." }, 400);
        }

        const body = await c.req.json();

        if (!body || Object.keys(body).length === 0) {
            return c.json({ success: false, error: "Pelo menos um campo deve ser fornecido." }, 400);
        }

        const service = new UpdateCleanerService(c.env);

        try {
            const updated = await service.update(parsedId, body);

            if (!updated) {
                return c.json({ success: false, error: "Faxineira não encontrada." }, 404);
            }

            return c.json({ success: true, message: "Faxineira atualizada com sucesso." }, 200);
        } catch (e: any) {
            console.error(e);
            return c.json({ success: false, error: e.message }, 500);
        }
    }
}
