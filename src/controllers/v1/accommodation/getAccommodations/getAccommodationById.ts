import { OpenAPIRoute } from "chanfana";
import { Context } from "hono";
import { z } from "zod";
import { GetAccommodationsService } from "../../../../services/v1/accommodation/getAccommodationsService";
import { Env } from "../../../../types/configTypes";

export class GetAccommodationById extends OpenAPIRoute {
    schema = {
        tags: ["Accommodations"],
        summary: "Buscar apartamento e perfil de limpeza",
        request: {
            params: z.object({
                id: z.string(),
            }),
        },
        responses: {
            "200": {
                description: "Apartamento encontrado",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            accommodation: z.any(),
                        }),
                    },
                },
            },
            "404": {
                description: "Apartamento nao encontrado",
            },
        },
    };

    async handle(c: Context<{ Bindings: Env }>) {
        const { id } = c.req.param();
        const service = new GetAccommodationsService(c.env);

        try {
            const accommodation = await service.getById(id);
            if (!accommodation) {
                return c.json({ success: false, error: "Apartamento nao encontrado." }, 404);
            }

            return c.json({ success: true, accommodation }, 200);
        } catch (error: any) {
            console.error("[GetAccommodationById] Erro:", error);
            return c.json({ success: false, error: error.message }, 500);
        }
    }
}
