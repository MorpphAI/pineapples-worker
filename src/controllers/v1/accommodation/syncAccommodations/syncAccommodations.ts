import { OpenAPIRoute } from "chanfana";
import { Context } from "hono";
import { z } from "zod";
import { SyncAccommodationsService } from "../../../../services/v1/accommodation/syncAccommodationsService";
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
                        }),
                    },
                },
            },
        },
    };

    async handle(c: Context<{ Bindings: Env }>) {
        const service = new SyncAccommodationsService(c.env);

        try {
            const synced = await service.sync();
            return c.json({ success: true, synced }, 200);
        } catch (error: any) {
            console.error("[SyncAccommodations] Erro:", error);
            return c.json({ success: false, error: error.message }, 500);
        }
    }
}
