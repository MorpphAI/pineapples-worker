import { OpenAPIRoute } from "chanfana";
import { Context } from "hono";
import { AvantioApiGateway } from "../../../../apiGateways/avantio/getAppointments";
import { AccommodationIndexError, AccommodationReferenceIndexRepository } from "../../../../repositories/accommodation/accommodationReferenceIndexRepository";
import { Env } from "../../../../types/configTypes";

type CatalogContext = Context<{ Bindings: Env }>;

function jsonError(c: CatalogContext, status: 400 | 404 | 409 | 422 | 500 | 502 | 503, code: string, message: string) {
  return c.json({ success: false, error: { code, message } }, status);
}

export class AvantioAccommodationCatalog extends OpenAPIRoute {
  schema = {
    tags: ["Avantio"],
    summary: "List the current complete Avantio accommodation catalog snapshot",
    responses: {
      "200": { description: "Active accommodation catalog generation" },
      "503": { description: "Catalog generation is not ready" },
    },
  };

  async handle(c: CatalogContext) {
    const rawLimit = Number(c.req.query("limit") ?? "100");
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, Math.floor(rawLimit))) : 100;
    const cursor = c.req.query("cursor")?.trim() || null;

    try {
      const page = await new AccommodationReferenceIndexRepository(c.env.DB)
        .listActiveRecords(limit, cursor);
      return c.json({
        success: true,
        records: page.records,
        next_cursor: page.next_cursor,
        index_completed_at: page.completed_at,
      }, 200);
    } catch (error) {
      const code = error instanceof AccommodationIndexError
        ? error.code
        : "accommodation_catalog_unavailable";
      return jsonError(c, 503, code, "O catálogo da Avantio ainda não está disponível.");
    }
  }
}

export class AvantioAccommodationDetail extends OpenAPIRoute {
  schema = {
    tags: ["Avantio"],
    summary: "Read one accommodation directly from Avantio",
    responses: {
      "200": { description: "Raw provider detail for PineOS server-side import" },
      "502": { description: "Provider detail could not be read" },
    },
  };

  async handle(c: CatalogContext) {
    const accommodationId = c.req.param("id")?.trim();
    if (!accommodationId) {
      return jsonError(c, 422, "invalid_accommodation_id", "ID da acomodação é obrigatório.");
    }

    try {
      const detail = await new AvantioApiGateway(c.env).getAccommodationStrict(accommodationId);
      return c.json({ success: true, accommodation_id: accommodationId, detail }, 200);
    } catch (error) {
      console.error("[AvantioAccommodationDetail] detail_read_failed", {
        accommodation_id: accommodationId,
        error: error instanceof Error ? error.name : "unknown",
      });
      return jsonError(c, 502, "avantio_detail_unavailable", "Não foi possível ler o detalhe da acomodação.");
    }
  }
}
