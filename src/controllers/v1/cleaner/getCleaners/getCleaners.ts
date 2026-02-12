import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { Env } from "../../../../types/configTypes";
import { CleanerService } from "../../../../services/v1/cleaner/getCleaners/getCleaners";

export class GetCleaner extends OpenAPIRoute {
    schema = {
        tags: ["Cleaners"],
        summary: "Listar todas as faxineiras",
        description: "Retorna uma lista com todas as faxineiras cadastradas no sistema, incluindo ativas e inativas.",
        responses: {
            "200": {
                description: "Lista de faxineiras recuperada com sucesso",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            count: z.number(),
                            cleaners: z.array(z.object({
                                id: z.number(),
                                name: z.string(),
                                zones: z.string(),
                                shift_start: z.string(),
                                shift_end: z.string(),
                                is_active: z.number(),
                                is_fixed: z.number().optional(),
                                fixed_accommodations: z.string().nullable().optional()
                            }))
                        }),
                    },
                },
            },
            "500": {
                description: "Erro interno",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            error: z.string()
                        })
                    }
                }
            }
        },
    };

    async handle(c: Context<{ Bindings: Env }>) {
        const service = new CleanerService(c.env);

        try {
            const cleaners = await service.listAllCleaners();
            
            return c.json({ 
                success: true, 
                count: cleaners.length,
                cleaners: cleaners
            }, 200);
        } catch (e: any) {
            console.error(e);
            return c.json({ success: false, error: e.message }, 500);
        }
    }
}