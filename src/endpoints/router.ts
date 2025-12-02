import { Hono } from "hono";
import { fromHono } from "chanfana";
import { GetAppointments } from "./avantio/getAppointments";
import { Env } from "../types/avantioTypes";

export const avantioRouter = fromHono(new Hono<{ Bindings: Env }>());

avantioRouter.get("/v1/appointments", GetAppointments);