import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { Env } from "../../../../types/configTypes";
import { UpdateCleanerService } from "../../../../services/v1/cleaner/updateCleaner/updateCleanerService";

export class UpdateCleaner extends OpenAPIRoute {
    schema = {
        tags: ["Cleaners"],
        summary: "Ativar ou inativar faxineira",
        description: "Atualiza o status de ativação de uma faxineira pelo ID.",
        request: {
            params: z.object({
                id: z.string().describe("ID da faxineira"),
            }),
            body: {
                content: {
                    "application/json": {
                        schema: z.object({
                            is_active: z.boolean(),
                        }),
                    },
                },
            },
        },
        responses: {
            "200": {
                description: "Status atualizado com sucesso",
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
                description: "ID inválido",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            error: z.string(),
                        }),
                    },
                },
            },
            "404": {
                description: "Faxineira não encontrada",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            error: z.string(),
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
                            error: z.string(),
                        }),
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

        const body = await c.req.json<{ is_active: boolean }>();
        const service = new UpdateCleanerService(c.env);

        try {
            const updated = await service.updateStatus(parsedId, body.is_active);

            if (!updated) {
                return c.json({ success: false, error: "Faxineira não encontrada." }, 404);
            }

            return c.json(
                { success: true, message: "Faxineira ativada/inativada com sucesso." },
                200
            );
        } catch (e: any) {
            console.error(e);
            return c.json({ success: false, error: e.message }, 500);
        }
    }
}
