import { Hono } from "hono";
import { fromHono } from "chanfana";
import { GetAppointments } from "./v1/avantio/GetAppointments";
import { CreateCleaners } from "./v1/cleaner/createCleaners/createCleaner";
import { CreateScales } from "./v1/scale/postScale";
import { GetScaleView } from "./v1/scale/getScale";
import { ExportScale } from "./v1/scale/exportScale"; 
import { PriorityWithCleaner } from "./v1/priority/priorityWithCleaner/priorityWithCleaner";
import { Priority } from "./v1/priority/getPriority/getPriority";
import { CreateOffDays } from "./v1/cleaner/createOffDays/createOffDays";
import { GetOffDays } from "./v1/cleaner/getOffDaysByMonth/getOffDays";
import { GetCleaner } from "./v1/cleaner/getCleaners/getCleaners";
import { Env } from "../types/configTypes";

export const pineapplesRouter = fromHono(new Hono<{ Bindings: Env }>());

pineapplesRouter.get("/v1/appointments", GetAppointments);

pineapplesRouter.post("/v1/cleaner", CreateCleaners);
pineapplesRouter.post("/v1/cleaner/offdays", CreateOffDays);
pineapplesRouter.get("/v1/cleaner", GetCleaner);
pineapplesRouter.get("/v1/cleaner/offdays", GetOffDays);

pineapplesRouter.post("/v1/scale", CreateScales);
pineapplesRouter.get("/v1/scale", GetScaleView);
pineapplesRouter.get("/v1/scale/:id/export", ExportScale);

pineapplesRouter.get("/v1/priority", Priority);
pineapplesRouter.get("/v1/priority/cleaner", PriorityWithCleaner);