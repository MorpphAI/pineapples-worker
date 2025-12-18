import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { AvantioService } from "../../services/avantio/avantioService";
import { Env } from "../../types/configTypes";
import { Context } from "hono";

export class GetAppointments extends OpenAPIRoute {
	schema = {
		tags: ["Avantio"],
		summary: "Disparo Manual: Sincronizar Check-ins e Check-outs sem realizar logica de prioridade, somente para consutas",
		description: "Esta rota executa a mesma lógica do Cron Job. Use para forçar uma atualização agora.",
		request: {
			query: z.object({
				date: z.string().date().optional().describe("Data específica (YYYY-MM-DD). Se vazio, usa HOJE."),
			}),
		},
		responses: {
			"200": {
				description: "Sucesso",
				content: {
					"application/json": {
						schema: z.object({
							status: z.string(),
							message: z.string(),
							data: z.object({
								totalCheckins: z.number(),
								totalCheckouts: z.number(),
								checkins: z.array(z.any()), 
                                checkouts: z.array(z.any()),
							}),
						}),
					},
				},
			},
		},
	};

		async handle(c: Context<{ Bindings: Env }>) {
		
		const data = await this.getValidatedData<typeof this.schema>();

		const service = new AvantioService(c.env as Env);
		
		const today = new Date().toISOString().split("T")[0];

		const filterDate = data.query.date || today;

		try {
			const [checkins, checkouts] = await Promise.all([
				service.getCheckins(filterDate),
				service.getCheckouts(filterDate)
			]);

			return c.json({
				status: "success",
				message: `Sincronização manual realizada para ${filterDate}`,
				data: {
					Totalcheckins: checkins.length,
					Totalcheckouts: checkouts.length,
					checkins: checkins,
                    checkouts: checkouts,
				},
			});
		} catch (error: any) {
			return c.json({ status: "error", message: error.message }, 500);
		}
	}
}