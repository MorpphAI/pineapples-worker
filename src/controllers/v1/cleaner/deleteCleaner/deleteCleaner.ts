import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { Env } from "../../../../types/configTypes";
import { DeleteCleanerService } from "../../../../services/v1/cleaner/deleteCleaner/deleteCleanerService";

export class DeleteCleaner extends OpenAPIRoute {
    schema = {
        tags: ["Cleaners"],
        summary: "Deletar faxineira",
        description: "Remove permanentemente uma faxineira pelo ID.",
        request: {
            params: z.object({
                id: z.string().describe("ID da faxineira"),
            }),
        },
        responses: {
            "200": {
                description: "Faxineira deletada com sucesso",
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

        const service = new DeleteCleanerService(c.env);

        try {
            const deleted = await service.delete(parsedId);

            if (!deleted) {
                return c.json({ success: false, error: "Faxineira não encontrada." }, 404);
            }

            return c.json({ success: true, message: "Faxineira deletada com sucesso." }, 200);
        } catch (e: any) {
            console.error(e);
            return c.json({ success: false, error: e.message }, 500);
        }
    }
}
