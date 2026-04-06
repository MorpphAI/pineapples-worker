import { Hono } from "hono";
import { fromHono } from "chanfana";
import { GetAppointments } from "./v1/appointments/GetAppointments/GetAppointments";
import { CreateCleaners } from "./v1/cleaner/createCleaners/createCleaner";
import { CreateScales } from "./v1/scale/createScale/CreateScale";
import { GetScaleView } from "./v1/scale/getScale.ts/getScale";
import { ExportScale } from "./v1/scale/getScaleExport/exportScale"; 
import { GetPriorityWithCleaner } from "./v1/priority/getPriorityWithCleaner/getPriorityWithCleaner";
import { Priority } from "./v1/priority/getPriority/getPriority";
import { CreateOffDays } from "./v1/cleaner/createOffDays/createOffDays";
import { GetOffDays } from "./v1/cleaner/getOffDaysByMonth/getOffDays";
import { GetCleaner } from "./v1/cleaner/getCleaners/getCleaners";
import { UpdateCleaner } from "./v1/cleaner/updateCleaner/updateCleaner";
import { DeleteCleaner } from "./v1/cleaner/deleteCleaner/deleteCleaner";
import { Env } from "../types/configTypes";

export const pineapplesRouter = fromHono(new Hono<{ Bindings: Env }>());

pineapplesRouter.get("/v1/appointments", GetAppointments);

pineapplesRouter.post("/v1/cleaner", CreateCleaners);
pineapplesRouter.post("/v1/cleaner/offdays", CreateOffDays);
pineapplesRouter.get("/v1/cleaner", GetCleaner);
pineapplesRouter.get("/v1/cleaner/offdays", GetOffDays);
pineapplesRouter.patch("/v1/cleaner/:id", UpdateCleaner);
pineapplesRouter.delete("/v1/cleaner/:id", DeleteCleaner);

pineapplesRouter.post("/v1/scale", CreateScales);
pineapplesRouter.get("/v1/scale", GetScaleView);
pineapplesRouter.get("/v1/scale/:id/export", ExportScale);

pineapplesRouter.get("/v1/priority", Priority);
pineapplesRouter.get("/v1/priority/cleaner", GetPriorityWithCleaner);