import { fromHono } from "chanfana";
import { Hono } from "hono";
import { AvantioService } from "./services/avantio/avantioService";
import { Env } from "./types/configTypes";
import { pineapplesRouter } from "./controllers/router";

const app = new Hono<{ Bindings: Env }>();

const openapi = fromHono(app, {
	docs_url: "/", 
	schema: {
		info: {
			title: "Pineapple de limpeza para acomodações",
			version: "1.0.0",
			description: "API para sincronizar check-ins/outs e montar escala de limpeza.",
		},
	},
});

openapi.route("/", pineapplesRouter);


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
				
			} catch (error) {
				console.error("[Cron] Falha na execução:", error);
			}
		})());
	},
};