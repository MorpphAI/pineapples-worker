import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { Env } from "../../../../types/configTypes";
import { UpdateCleanerService } from "../../../../services/v1/cleaner/updateCleaner/updateCleanerService";
import { booleanLike } from "../../../../utils/booleanLike";

export class UpdateCleaner extends OpenAPIRoute {
    schema = {
        tags: ["Cleaners"],
        summary: "Atualizar faxineira",
        description: "Atualiza um ou mais campos de uma faxineira pelo ID. Todos os campos sao opcionais.",
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
                            phone: z.string().nullable().optional(),
                            fixed_accommodations: z.string().nullable().optional(),
                            is_fixed: booleanLike.optional(),
                            is_active: booleanLike.optional(),
                        }).refine(data => Object.keys(data).length > 0, {
                            message: "Pelo menos um campo deve ser fornecido.",
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
                description: "ID invalido ou body vazio",
                content: {
                    "application/json": {
                        schema: z.object({ success: z.boolean(), error: z.string() }),
                    },
                },
            },
            "404": {
                description: "Faxineira nao encontrada",
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
            return c.json({ success: false, error: "ID invalido." }, 400);
        }

        const data = await this.getValidatedData<typeof this.schema>();
        const service = new UpdateCleanerService(c.env);

        try {
            const updated = await service.update(parsedId, data.body);

            if (!updated) {
                return c.json({ success: false, error: "Faxineira nao encontrada." }, 404);
            }

            return c.json({ success: true, message: "Faxineira atualizada com sucesso." }, 200);
        } catch (e: any) {
            console.error(e);
            return c.json({ success: false, error: e.message }, 500);
        }
    }
}
