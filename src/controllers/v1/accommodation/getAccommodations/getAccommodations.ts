import { OpenAPIRoute } from "chanfana";
import { Context } from "hono";
import { z } from "zod";
import { GetAccommodationsService } from "../../../../services/v1/accommodation/getAccommodationsService";
import { Env } from "../../../../types/configTypes";

export class GetAccommodations extends OpenAPIRoute {
    schema = {
        tags: ["Accommodations"],
        summary: "Listar apartamentos e perfis de limpeza",
        request: {
            query: z.object({
                q: z.string().optional(),
                zone: z.string().optional(),
                hasOverride: z.enum(["true", "false"]).optional(),
                flags: z.enum(["missingArea", "missingZone", "largeWithoutReview"]).optional(),
                status: z.string().optional(),
            }),
        },
        responses: {
            "200": {
                description: "Apartamentos encontrados",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            count: z.number(),
                            accommodations: z.array(z.any()),
                        }),
                    },
                },
            },
        },
    };

    async handle(c: Context<{ Bindings: Env }>) {
        const data = await this.getValidatedData<typeof this.schema>();
        const service = new GetAccommodationsService(c.env);

        try {
            const accommodations = await service.list(data.query);
            return c.json({
                success: true,
                count: accommodations.length,
                accommodations,
            }, 200);
        } catch (error: any) {
            console.error("[GetAccommodations] Erro:", error);
            return c.json({ success: false, error: error.message }, 500);
        }
    }
}
