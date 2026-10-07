import { OpenAPIRoute } from "chanfana";
import { Context } from "hono";
import { AvantioApiGateway } from "../../../../apiGateways/avantio/getAppointments";
import { AccommodationIndexError, AccommodationReferenceIndexRepository } from "../../../../repositories/accommodation/accommodationReferenceIndexRepository";
import { Env } from "../../../../types/configTypes";
import { AccommodationSyncError, SyncAccommodationsService } from "../../../../services/v1/accommodation/syncAccommodationsService";

type CatalogContext = Context<{ Bindings: Env }>;

function hasParentheticalProductionMarker(value: unknown): boolean {
  return typeof value === "string" && /\([^)]*\)/.test(value);
}

function hasInternalTestMarker(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return /(teste|test|mock|demo|fake|homolog|sandbox|probe|m0rph|morph)/.test(normalized)
    || /^modelo(?:\b|-|\d)/.test(normalized);
}

function isPineOsImportEligible(record: { name: string | null; external_reference: string | null }): boolean {
  return !hasParentheticalProductionMarker(record.name)
    && !hasParentheticalProductionMarker(record.external_reference)
    && !hasInternalTestMarker(record.name)
    && !hasInternalTestMarker(record.external_reference);
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(",")}}`;
}

async function stableFingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableSerialize(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function jsonError(c: CatalogContext, status: 400 | 404 | 409 | 422 | 500 | 502 | 503, code: string, message: string) {
  return c.json({ success: false, error: { code, message } }, status);
}

export class AvantioRecentAccommodations extends OpenAPIRoute {
  schema = {
    tags: ["Avantio"],
    summary: "Read only the newest Avantio accommodation page",
    responses: {
      "200": { description: "Newest accommodation page from Avantio" },
      "502": { description: "Provider page could not be read" },
    },
  };

  async handle(c: CatalogContext) {
    const rawLimit = Number(c.req.query("limit") ?? "50");
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, Math.floor(rawLimit))) : 50;

    try {
      const gateway = new AvantioApiGateway(c.env);
      const firstPage = await gateway.getAccommodationsPage(null, limit);
      const page =
        firstPage.lastPageUrl && firstPage.nextPageUrl
          ? await gateway.getAccommodationsPage(firstPage.lastPageUrl, limit)
          : firstPage;

      const records: Array<{
        accommodation_id: string;
        external_reference: string | null;
        name: string | null;
        remote_status: string | null;
        provider_updated_at: string | null;
        provider_fingerprint: string;
      }> = [];

      for (const item of page.records) {
        const id = typeof item.id === "string" || typeof item.id === "number"
          ? String(item.id).trim()
          : typeof item.accommodationId === "string" || typeof item.accommodationId === "number"
            ? String(item.accommodationId).trim()
            : typeof item.accommodation_id === "string" || typeof item.accommodation_id === "number"
              ? String(item.accommodation_id).trim()
              : "";
        if (!id) continue;

        const record = {
          accommodation_id: id,
          external_reference:
            typeof item.externalReference === "string" && item.externalReference.trim()
              ? item.externalReference.trim()
              : null,
          name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : null,
          remote_status:
            typeof item.status === "string" && item.status.trim() ? item.status.trim() : null,
          provider_updated_at:
            typeof item.updatedAt === "string" && item.updatedAt.trim()
              ? item.updatedAt.trim()
              : typeof item.updated_at === "string" && item.updated_at.trim()
                ? item.updated_at.trim()
                : null,
          provider_fingerprint: await stableFingerprint(item),
        };

        if (isPineOsImportEligible(record)) records.push(record);
      }

      return c.json({
        success: true,
        records,
        page_source: firstPage.lastPageUrl && firstPage.nextPageUrl ? "last" : "only",
      }, 200);
    } catch (error) {
      console.error("[AvantioRecentAccommodations] provider_page_failed", {
        error: error instanceof Error ? error.name : "unknown",
      });
      return jsonError(c, 502, "avantio_recent_unavailable", "Não foi possível ler os imóveis recentes da Avantio.");
    }
  }
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
      // Older PineOS Edge deployments do not have the explicit refresh_index
      // command. For those callers, advance one bounded live batch per catalog
      // page. Newer Edge deployments refresh first and opt out via this header.
      const alreadyRefreshed = c.req.header("x-pineos-index-refreshed") === "1";
      if (!alreadyRefreshed) {
        try {
          await new SyncAccommodationsService(c.env).sync();
        } catch (error) {
          const refreshCode = error instanceof AccommodationSyncError
            ? error.code
            : "accommodation_index_batch_failed";
          console.warn(`[AvantioAccommodationCatalog] refresh_best_effort code=${refreshCode}`);
        }
      }

      const page = await new AccommodationReferenceIndexRepository(c.env.DB)
        .listActiveRecords(limit, cursor);
      const eligibleRecords = page.records.filter(isPineOsImportEligible);
      return c.json({
        success: true,
        records: eligibleRecords,
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
