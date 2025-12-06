import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { CleanerService } from "../../services/cleanerService";
import { Env } from "../../types/configTypes";

export class CreateCleaners extends OpenAPIRoute {
    schema = {
        tags: ["Cleaners"],
        summary: "Cadastro de Equipe em Lote",
        description: "Recebe uma lista de colaboradores e cadastra todos de uma vez.",
        request: {
            body: {
                content: {
                    "application/json": {
                        schema: z.object({
                            cleaners: z.array(z.object({
                                name: z.string().min(3),
                                zones: z.string().describe("Zonas separadas por vírgula"),
                                shift_start: z.string().regex(/^\d{2}:\d{2}$/, "HH:MM"),
                                shift_end: z.string().regex(/^\d{2}:\d{2}$/, "HH:MM"),
                            })).min(1, "A lista não pode estar vazia")
                        }),
                    },
                },
            },
        },
        responses: {
            "201": {
                description: "Equipe cadastrada com sucesso",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            message: z.string(),
                            count: z.number()
                        }),
                    },
                },
            },
        },
    };

    async handle(c) {
        const data = await this.getValidatedData<typeof this.schema>();
        const { cleaners } = data.body;

        const service = new CleanerService(c.env as Env);
        
        try {
            await service.registerCleanersBatch(cleaners);

            return c.json({
                success: true,
                message: "Lote processado com sucesso",
                count: cleaners.length
            }, 201);
        } catch (error: any) {
            return c.json({ success: false, message: error.message }, 500);
        }
    }
}