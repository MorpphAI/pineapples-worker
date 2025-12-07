import { Hono } from "hono";
import { fromHono } from "chanfana";
import { GetAppointments } from "./avantio/appointments";
import { CreateCleaners } from "./cleaner/cleaner";
import { CreateScales } from "./scale/scale";
import { GeneratePriority } from "./priority/priority";
import { Env } from "../types/configTypes";

export const pineapplesRouter = fromHono(new Hono<{ Bindings: Env }>());

pineapplesRouter.get("/v1/appointments", GetAppointments);
pineapplesRouter.post("/v1/cleaner", CreateCleaners);
pineapplesRouter.post("/v1/scale", CreateScales);
pineapplesRouter.get("/v1/Generatepriority", GeneratePriority);