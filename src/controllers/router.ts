import { Hono } from "hono";
import { fromHono } from "chanfana";
import { GetAppointments } from "./v1/avantio/GetAppointments";
import { CreateCleaners } from "./v1/cleaner/PostCleaner";
import { CreateScales } from "./v1/scale/scale";
import { ExportScale } from "./v1/scale/exportScale"; 
import { PriorityWithCleaner } from "./v1/priority/GetPriorityCleaner";
import { Priority } from "./v1/priority/GetPriority";
import { CreateOffDayBatch } from "./v1/cleaner/PostOffDayBatch";
import { GetOffDayBatch } from "./v1/cleaner/GetOffDayBatch";
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