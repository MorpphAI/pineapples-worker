import { Context, Next } from "hono";
import { Env } from "../types/configTypes";

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
    const apiKey = c.req.header("x-api-key");

    if (!apiKey || apiKey !== c.env.API_KEY) {
        return c.json({ success: false, error: "Unauthorized" }, 401);
    }

    await next();
}
