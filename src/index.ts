import { fromHono } from "chanfana";
import { Hono } from "hono";
import { Env } from "./types/configTypes";
import { pineapplesRouter } from "./controllers/router";
import { authMiddleware } from "./middleware/auth";
import { AccommodationSyncError, SyncAccommodationsService } from "./services/v1/accommodation/syncAccommodationsService";
import { AccommodationIndexStatusService } from "./services/v1/accommodation/accommodationIndexStatusService";

const app = new Hono<{ Bindings: Env }>();

app.use("*", authMiddleware);

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


export async function runScheduledAccommodationIndexBatch(env: Env): Promise<void> {
	try {
		const status = await new AccommodationIndexStatusService(env).status();
		if (status.fresh && !status.building) {
			console.log(`[AccommodationIndexScheduled] stage=skip code=index_fresh age_seconds=${status.age_seconds ?? -1} max_age_seconds=${status.max_age_seconds}`);
			return;
		}

		const result = await new SyncAccommodationsService(env).sync();
		const code = result.complete ? "generation_complete" : "batch_processed";
		console.log(`[AccommodationIndexScheduled] stage=sync code=${code} synced=${result.synced} processed_records=${result.processed_records} processed_pages=${result.processed_pages}`);
	} catch (error) {
		const code = error instanceof AccommodationSyncError ? error.code : "accommodation_index_batch_failed";
		console.error(`[AccommodationIndexScheduled] stage=sync code=${code}`);
	}
}

export default {
	fetch: app.fetch,
	scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
		ctx.waitUntil(runScheduledAccommodationIndexBatch(env));
	},
};
