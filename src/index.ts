import { fromHono } from "chanfana";
import { Hono } from "hono";
import { AvantioService } from "./services/avantioService";
import { Env } from "./types/avantioTypes";
import { avantioRouter } from "./endpoints/router";

const app = new Hono<{ Bindings: Env }>();

const openapi = fromHono(app, {
	docs_url: "/", 
	schema: {
		info: {
			title: "escala de acomodações",
			version: "1.0.0",
			description: "API para sincronizar check-ins/outs e montar escala de limpeza.",
		},
	},
});

openapi.route("/", avantioRouter);


export default {
	fetch: app.fetch,

	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		
        console.log("[Cron] Iniciando execução agendada...");
		
        const service = new AvantioService(env);
        
		const today = new Date().toISOString().split('T')[0];

		ctx.waitUntil((async () => {
			try {
				const checkins = await service.getCheckins(today);
				const checkouts = await service.getCheckouts(today);
				
				console.log(`[Cron] Sucesso! Processados ${checkins.length} check-ins e ${checkouts.length} check-outs.`);
				
				// AQUI entrará a lógica futura:
				// await database.save(checkins, checkouts);
				// await cleanerService.createSchedule(checkins, checkouts);
				
			} catch (error) {
				console.error("[Cron] Falha na execução:", error);
			}
		})());
	},
};