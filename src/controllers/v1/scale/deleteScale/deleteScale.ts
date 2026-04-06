import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { Env } from "../../../../types/configTypes";
import { DeleteScaleService } from "../../../../services/v1/scale/deleteScale/deleteScaleService";

export class DeleteScale extends OpenAPIRoute {
    schema = {
        tags: ["Scales"],
        summary: "Deletar escala",
        description: "Remove permanentemente uma escala e todos os seus itens (CASCADE) pelo ID do run.",
        request: {
            params: z.object({
                runId: z.string().describe("ID do run de escala"),
            }),
        },
        responses: {
            "200": {
                description: "Escala deletada com sucesso",
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
                description: "Escala não encontrada",
                content: { "application/json": { schema: z.object({ success: z.boolean(), error: z.string() }) } },
            },
            "500": {
                description: "Erro interno",
                content: { "application/json": { schema: z.object({ success: z.boolean(), error: z.string() }) } },
            },
        },
    };

    async handle(c: Context<{ Bindings: Env }>) {
        const { runId } = c.req.param();
        const parsedId = parseInt(runId, 10);

        if (isNaN(parsedId)) {
            return c.json({ success: false, error: "ID inválido." }, 400);
        }

        const service = new DeleteScaleService(c.env);

        try {
            const deleted = await service.delete(parsedId);

            if (!deleted) {
                return c.json({ success: false, error: "Escala não encontrada." }, 404);
            }

            return c.json({ success: true, message: "Escala deletada com sucesso." }, 200);
        } catch (e: any) {
            console.error(e);
            return c.json({ success: false, error: e.message }, 500);
        }
    }
}
