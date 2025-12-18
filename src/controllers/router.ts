import { Hono } from "hono";
import { fromHono } from "chanfana";
import { GetAppointments } from "./avantio/GetAppointments";
import { CreateCleaners } from "./cleaner/PostCleaner";
import { CreateScales } from "./scale/scale";
import { ExportScale } from "./scale/exportScale"; 
import { PriorityWithCleaner } from "./priority/GetPriorityCleaner";
import { Priority } from "./priority/GetPriority";
import { CreateOffDayBatch } from "./cleaner/PostOffDayBatch";
import { GetOffDayBatch } from "./cleaner/GetOffDayBatch";
import { Env } from "../types/configTypes";

export const pineapplesRouter = fromHono(new Hono<{ Bindings: Env }>());

pineapplesRouter.get("/v1/appointments", GetAppointments);

pineapplesRouter.post("/v1/cleaner", CreateCleaners);
pineapplesRouter.post("/v1/cleaner/offdays", CreateOffDayBatch);
pineapplesRouter.get("/v1/cleaner/offdays", GetOffDayBatch);

pineapplesRouter.post("/v1/scale", CreateScales);
pineapplesRouter.get("/v1/scale/:id/export", ExportScale);

pineapplesRouter.get("/v1/priority", Priority);
pineapplesRouter.get("/v1/priority/cleaner", PriorityWithCleaner);