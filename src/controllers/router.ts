import { Hono } from "hono";
import { fromHono } from "chanfana";
import { GetAppointments } from "./avantio/appointments";
import { CreateCleaners } from "./cleaner/cleaner";
import { CreateScales } from "./scale/scale";
import { ExportScale } from "./scale/exportScale"; 
import { PriorityWithCleaner } from "./priority/priorityWithCleaner";
import { Priority } from "./priority/priority";
import { CreateOffDayBatch } from "./cleaner/offDayBatch";
import { Env } from "../types/configTypes";

export const pineapplesRouter = fromHono(new Hono<{ Bindings: Env }>());

pineapplesRouter.get("/v1/appointments", GetAppointments);
pineapplesRouter.post("/v1/cleaner", CreateCleaners);
pineapplesRouter.post("/v1/cleaner/offdays", CreateOffDayBatch);
pineapplesRouter.post("/v1/scale", CreateScales);
pineapplesRouter.get("/v1/scale/:id/export", ExportScale);
pineapplesRouter.get("/v1/priority", Priority);
pineapplesRouter.get("/v1/priority/cleaner", PriorityWithCleaner);