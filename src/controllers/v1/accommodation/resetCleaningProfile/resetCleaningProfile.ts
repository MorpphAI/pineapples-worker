import { OpenAPIRoute } from "chanfana";
import { Context } from "hono";
import { z } from "zod";
import { ResetAccommodationCleaningProfileService } from "../../../../services/v1/accommodation/resetCleaningProfileService";
import { Env } from "../../../../types/configTypes";

export class ResetAccommodationCleaningProfile extends OpenAPIRoute {
    schema = {
        tags: ["Accommodations"],
        summary: "Resetar perfil de limpeza para padrao",
        request: {
            params: z.object({
                id: z.string(),
            }),
        },
        responses: {
            "200": {
                description: "Perfil resetado",
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
        const service = new ResetAccommodationCleaningProfileService(c.env);

        try {
            const accommodation = await service.reset(id);
            if (!accommodation) {
                return c.json({ success: false, error: "Apartamento nao encontrado." }, 404);
            }

            return c.json({ success: true, accommodation }, 200);
        } catch (error: any) {
            console.error("[ResetAccommodationCleaningProfile] Erro:", error);
            return c.json({ success: false, error: error.message }, 500);
        }
    }
}
