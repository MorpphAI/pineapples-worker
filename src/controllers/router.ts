import { Hono } from "hono";
import { fromHono } from "chanfana";
import { GetAppointments } from "./v1/appointments/GetAppointments/GetAppointments";
import { CreateCleaners } from "./v1/cleaner/createCleaners/createCleaner";
import { GetCleaner } from "./v1/cleaner/getCleaners/getCleaners";
import { GetCleanerById } from "./v1/cleaner/getCleanerById/getCleanerById";
import { UpdateCleaner } from "./v1/cleaner/updateCleaner/updateCleaner";
import { DeleteCleaner } from "./v1/cleaner/deleteCleaner/deleteCleaner";
import { CreateOffDays } from "./v1/cleaner/createOffDays/createOffDays";
import { GetOffDays } from "./v1/cleaner/getOffDaysByMonth/getOffDays";
import { DeleteOffDay } from "./v1/cleaner/deleteOffDay/deleteOffDay";
import { GetCleanerSchedule } from "./v1/cleaner/getCleanerSchedule/getCleanerSchedule";
import { CreateScales } from "./v1/scale/createScale/CreateScale";
import { GetScaleView } from "./v1/scale/getScale.ts/getScale";
import { ExportScale } from "./v1/scale/getScaleExport/exportScale";
import { GetScaleHistory } from "./v1/scale/getScaleHistory/getScaleHistory";
import { DeleteScale } from "./v1/scale/deleteScale/deleteScale";
import { GetPriorityWithCleaner } from "./v1/priority/getPriorityWithCleaner/getPriorityWithCleaner";
import { Priority } from "./v1/priority/getPriority/getPriority";
import { Env } from "../types/configTypes";
import { GetAccommodations } from "./v1/accommodation/getAccommodations/getAccommodations";
import { GetAccommodationById } from "./v1/accommodation/getAccommodations/getAccommodationById";
import { UpdateAccommodationCleaningProfile } from "./v1/accommodation/updateCleaningProfile/updateCleaningProfile";
import { ResetAccommodationCleaningProfile } from "./v1/accommodation/resetCleaningProfile/resetCleaningProfile";
import { SyncAccommodations } from "./v1/accommodation/syncAccommodations/syncAccommodations";
import { CangeAuthorizationDecisions } from "./v1/cange/authorizationDecisions/authorizationDecisions";
import { RemovedKanbanAuthorizationSync } from "./v1/kanban/syncAuthorizationStatus/syncAuthorizationStatus";
import { AvantioAccommodationCreate, AvantioAccommodationReadiness, AvantioAccommodationReconcile } from "./v1/avantio/accommodations/phase3";

export const pineapplesRouter = fromHono(new Hono<{ Bindings: Env }>());

pineapplesRouter.get("/v1/appointments", GetAppointments);

pineapplesRouter.get("/v1/accommodations", GetAccommodations);
pineapplesRouter.post("/v1/accommodations/sync", SyncAccommodations);
pineapplesRouter.get("/v1/accommodations/:id", GetAccommodationById);
pineapplesRouter.patch("/v1/accommodations/:id/cleaning-profile", UpdateAccommodationCleaningProfile);
pineapplesRouter.post("/v1/accommodations/:id/reset-cleaning-profile", ResetAccommodationCleaningProfile);

pineapplesRouter.get("/v1/cange/authorization-decisions", CangeAuthorizationDecisions);
pineapplesRouter.post("/v1/cange/authorization-decisions", CangeAuthorizationDecisions);
pineapplesRouter.post("/v1/kanban/authorization-sync", RemovedKanbanAuthorizationSync);
pineapplesRouter.post("/v1/avantio/accommodations/readiness", AvantioAccommodationReadiness);
pineapplesRouter.post("/v1/avantio/accommodations/create", AvantioAccommodationCreate);
pineapplesRouter.post("/v1/avantio/accommodations/reconcile", AvantioAccommodationReconcile);

// Cleaners — rotas estáticas antes das dinâmicas (:id)
pineapplesRouter.post("/v1/cleaner", CreateCleaners);
pineapplesRouter.get("/v1/cleaner", GetCleaner);
pineapplesRouter.post("/v1/cleaner/offdays", CreateOffDays);
pineapplesRouter.get("/v1/cleaner/offdays", GetOffDays);
pineapplesRouter.delete("/v1/cleaner/offdays/:id", DeleteOffDay);
pineapplesRouter.get("/v1/cleaner/:id", GetCleanerById);
pineapplesRouter.get("/v1/cleaner/:id/schedule", GetCleanerSchedule);
pineapplesRouter.patch("/v1/cleaner/:id", UpdateCleaner);
pineapplesRouter.delete("/v1/cleaner/:id", DeleteCleaner);

// Scales — rotas estáticas antes das dinâmicas (:id / :runId)
pineapplesRouter.post("/v1/scale", CreateScales);
pineapplesRouter.get("/v1/scale", GetScaleView);
pineapplesRouter.get("/v1/scale/history", GetScaleHistory);
pineapplesRouter.delete("/v1/scale/:runId", DeleteScale);
pineapplesRouter.get("/v1/scale/:id/export", ExportScale);

pineapplesRouter.get("/v1/priority", Priority);
pineapplesRouter.get("/v1/priority/cleaner", GetPriorityWithCleaner);
