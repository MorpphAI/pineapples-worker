import { OpenAPIRoute } from "chanfana";
import { Context } from "hono";
import { z } from "zod";
import { AccommodationIndexStatusService } from "../../../../services/v1/accommodation/accommodationIndexStatusService";
import { Env } from "../../../../types/configTypes";

export class GetAccommodationIndexStatus extends OpenAPIRoute {
    schema = {
        tags: ["Accommodations"],
        summary: "Consultar estado sanitizado do índice de referências Avantio",
        responses: {
            "200": {
                description: "Estado do índice de referências",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.literal(true),
                            status: z.enum(["idle", "building", "complete", "failed"]),
                            active_generation_available: z.boolean(),
                            building: z.boolean(),
                            processed_records: z.number(),
                            processed_pages: z.number(),
                            started_at: z.string().nullable(),
                            completed_at: z.string().nullable(),
                            age_seconds: z.number().nullable(),
                            max_age_seconds: z.number(),
                            fresh: z.boolean(),
                            last_error_code: z.string().nullable(),
                        }),
                    },
                },
            },
        },
    };

    async handle(c: Context<{ Bindings: Env }>) {
        const result = await new AccommodationIndexStatusService(c.env).status();
        return c.json(result, 200);
    }
}
