import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { Env } from "../../../../types/configTypes";
import { DeleteOffDayService } from "../../../../services/v1/cleaner/deleteOffDay/deleteOffDayService";

export class DeleteOffDay extends OpenAPIRoute {
    schema = {
        tags: ["Cleaners"],
        summary: "Deletar folga",
        description: "Remove um registro de folga específico pelo ID.",
        request: {
            params: z.object({
                id: z.string().describe("ID da folga"),
            }),
        },
        responses: {
            "200": {
                description: "Folga deletada com sucesso",
                content: {
                    "application/json": {
                        schema: z.object({ success: z.boolean(), message: z.string() }),
                    },
                },
            },
            "400": {
                description: "ID inválido",
                content: { "application/json": { schema: z.object({ success: z.boolean(), error: z.string() }) } },
            },
            "404": {
                description: "Folga não encontrada",
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

        const service = new DeleteOffDayService(c.env);

        try {
            const deleted = await service.delete(parsedId);

            if (!deleted) {
                return c.json({ success: false, error: "Folga não encontrada." }, 404);
            }

            return c.json({ success: true, message: "Folga deletada com sucesso." }, 200);
        } catch (e: any) {
            console.error(e);
            return c.json({ success: false, error: e.message }, 500);
        }
    }
}
