import { fromHono } from "chanfana";
import { Hono } from "hono";
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
};
