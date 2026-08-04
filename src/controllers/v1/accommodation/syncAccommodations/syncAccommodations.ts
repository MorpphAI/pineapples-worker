import { OpenAPIRoute } from "chanfana";
import { Context } from "hono";
import { z } from "zod";
import { AccommodationSyncError, SyncAccommodationsService } from "../../../../services/v1/accommodation/syncAccommodationsService";
import { Env } from "../../../../types/configTypes";

export class SyncAccommodations extends OpenAPIRoute {
    schema = {
        tags: ["Accommodations"],
        summary: "Sincronizar apartamentos da Avantio",
        responses: {
            "200": {
                description: "Apartamentos sincronizados",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            synced: z.number(),
                            complete: z.boolean(),
                            processed_records: z.number(),
                            processed_pages: z.number(),
                            active_generation_available: z.boolean(),
                            building: z.boolean(),
                        }),
                    },
                },
            },
            "503": {
                description: "Sincronização incremental indisponível",
                content: {
                    "application/json": {
                        schema: z.object({ success: z.literal(false), synced: z.literal(0), error: z.string() }),
                    },
                },
            },
        },
    };

    async handle(c: Context<{ Bindings: Env }>) {
        const service = new SyncAccommodationsService(c.env);

        try {
            const result = await service.sync();
            return c.json({ success: true, ...result }, 200);
        } catch (error) {
            const code = error instanceof AccommodationSyncError ? error.code : "accommodation_index_batch_failed";
            console.error(`[SyncAccommodations] Falha sanitizada: ${code}`);
            return c.json({ success: false as const, synced: 0 as const, error: code }, 503);
        }
    }
}
