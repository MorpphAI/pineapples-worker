import { OpenAPIRoute } from "chanfana";
import { Context } from "hono";
import { z } from "zod";
import { CangeAuthorizationDecisionService } from "../../../../services/v1/cange/cangeAuthorizationDecisionService";
import { Env } from "../../../../types/configTypes";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function todayInSaoPaulo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export class CangeAuthorizationDecisions extends OpenAPIRoute {
  schema = {
    tags: ["Cange"],
    summary: "Build Avantio authorization decisions for Cange",
    request: {
      query: z.object({
        date: z.string().regex(DATE_PATTERN).optional(),
      }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              date: z.string().regex(DATE_PATTERN).optional(),
            }).optional(),
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Deterministic authorization decisions",
      },
      "400": {
        description: "Invalid date",
      },
    },
  };

  async handle(c: Context<{ Bindings: Env }>) {
    const requestUrl = new URL(c.req.url);
    const queryDate = requestUrl.searchParams.get("date");
    const bodyDate = await readBodyDate(c);
    const date = queryDate ?? bodyDate ?? todayInSaoPaulo();

    if (!isValidIsoDateOnly(date)) {
      return c.json({
        success: false,
        message: "date must be in YYYY-MM-DD format",
      }, 400);
    }

    try {
      const service = new CangeAuthorizationDecisionService(c.env);
      const result = await service.getDecisions(date);
      return c.json(result);
    } catch (error: unknown) {
      console.error("[CangeAuthorizationDecisions] Erro ao calcular decisoes", {
        message: error instanceof Error ? error.message : String(error),
      });
      return c.json({
        success: false,
        mode: "decision_only",
        date,
        error: "failed_to_build_authorization_decisions",
      }, 500);
    }
  }
}

async function readBodyDate(c: Context): Promise<string | null> {
  if (c.req.method !== "POST") return null;

  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return null;

  try {
    const body = await c.req.json<unknown>();
    if (isRecord(body) && typeof body.date === "string") return body.date;
    return null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidIsoDateOnly(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}
