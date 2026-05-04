import { OpenAPIRoute } from "chanfana";
import { Context } from "hono";
import { z } from "zod";
import { UpdateAccommodationCleaningProfileService } from "../../../../services/v1/accommodation/updateCleaningProfileService";
import { Env } from "../../../../types/configTypes";

export class UpdateAccommodationCleaningProfile extends OpenAPIRoute {
    schema = {
        tags: ["Accommodations"],
        summary: "Atualizar excecao de perfil de limpeza",
        request: {
            params: z.object({
                id: z.string(),
            }),
            body: {
                content: {
                    "application/json": {
                        schema: z.record(z.any()),
                    },
                },
            },
        },
        responses: {
            "200": {
                description: "Perfil atualizado",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            accommodation: z.any(),
                        }),
                    },
                },
            },
            "400": {
                description: "Payload invalido",
            },
            "404": {
                description: "Apartamento nao encontrado",
            },
        },
    };

    async handle(c: Context<{ Bindings: Env }>) {
        const { id } = c.req.param();

        let body: Record<string, unknown>;
        try {
            body = await c.req.json();
        } catch {
            return c.json({ success: false, error: "Body JSON invalido." }, 400);
        }

        const service = new UpdateAccommodationCleaningProfileService(c.env);

        try {
            const accommodation = await service.update(id, body);
            if (!accommodation) {
                return c.json({ success: false, error: "Apartamento nao encontrado." }, 404);
            }

            return c.json({ success: true, accommodation }, 200);
        } catch (error: any) {
            return c.json({ success: false, error: error.message }, 400);
        }
    }
}
