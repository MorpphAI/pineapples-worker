import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { Env } from "../../types/configTypes";
import { CleanerService } from "../../services/cleaner/cleanerService";

export class CreateCleaners extends OpenAPIRoute {
	schema = {
		tags: ["Cleaners"],
		summary: "Cadastrar equipe em Lote",
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							cleaners: z.array(z.object({
								name: z.string().min(2),
								zones: z.string().describe("Zonas separadas por vírgula"),
								shift_start: z.string().regex(/^\d{2}:\d{2}$/, "HH:MM"),
								shift_end: z.string().regex(/^\d{2}:\d{2}$/, "HH:MM"),
                                fixed_accommodations: z.string().optional().describe("Códigos/Nomes dos imóveis fixos"),
                                is_fixed: z.boolean().default(false).describe("Se true, limpa APENAS os imóveis fixos"),
								phone: z.string().optional(),
							})).min(1)
						}),
					},
				},
			},
		},
		responses: {
			"201": {
				description: "Criado com sucesso",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							count: z.number(),
						}),
					},
				},
			},
		},
	};

	async handle(c: Context<{ Bindings: Env }>) {
		const data = await this.getValidatedData<typeof this.schema>();
		const { cleaners } = data.body;

        const service = new CleanerService(c.env);
        
        try {
			await service.registerCleaners(cleaners as any);
			
            return c.json({ success: true, count: cleaners.length }, 201);
        } catch (e: any) {
            return c.json({ success: false, error: e.message }, 500);
        }
	}
}