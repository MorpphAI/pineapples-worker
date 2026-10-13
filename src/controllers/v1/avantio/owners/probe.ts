import { OpenAPIRoute } from "chanfana";
import { Context } from "hono";
import { probeAvantioOwnerRead, readAvantioOwner } from "../../../../apiGateways/avantio/ownerReadProbe";
import { Env } from "../../../../types/configTypes";

type WorkerContext = Context<{ Bindings: Env }>;

/**
 * Temporary and deliberately non-PII diagnostic endpoint.
 * Protected by the worker's global x-api-key middleware.
 */
export class AvantioOwnerReadProbe extends OpenAPIRoute {
  schema = {
    tags: ["Avantio"],
    summary: "Check read-only Avantio owner API capability without exposing owner data",
    responses: {
      "200": { description: "Provider statuses and safe field presence only" },
      "422": { description: "Invalid owner ID" },
    },
  };

  async handle(c: WorkerContext) {
    const ownerId = c.req.param("id")?.trim() ?? "";
    if (!/^\d{1,12}$/.test(ownerId)) {
      return c.json({ success: false, error: { code: "invalid_owner_id" } }, 422);
    }
    const result = await probeAvantioOwnerRead(c.env, ownerId);
    return c.json({ success: true, ...result }, 200);
  }
}

/** Private worker-key-only owner resolution used by the PineOS Edge importer.
 * Owner data must never be exposed by a browser-accessible PineOS command.
 */
export class AvantioOwnerDetail extends OpenAPIRoute {
  schema = {
    tags: ["Avantio"],
    summary: "Resolve a single exact Avantio owner ID for the server-side importer",
    responses: {
      "200": { description: "Resolved owner fields or unavailable read capability" },
      "422": { description: "Invalid owner ID" },
    },
  };

  async handle(c: WorkerContext) {
    const ownerId = c.req.param("id")?.trim() ?? "";
    if (!/^\d{1,12}$/.test(ownerId)) {
      return c.json({ success: false, error: { code: "invalid_owner_id" } }, 422);
    }
    const result = await readAvantioOwner(c.env, ownerId);
    return c.json({ success: true, ...result }, 200);
  }
}
