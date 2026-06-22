import { OpenAPIRoute } from "chanfana";
import { Context } from "hono";
import { z } from "zod";
import { SyncAuthorizationStatusService } from "../../../../services/v1/kanban/syncAuthorizationStatusService";
import { Env } from "../../../../types/configTypes";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export class SyncAuthorizationStatus extends OpenAPIRoute {
  schema = {
    tags: ["Kanban"],
    summary: "Sincronizar autorizacao de cards Kanban a partir da Avantio",
    request: {
      query: z.object({
        date: z.string().optional().describe("Data alvo (YYYY-MM-DD). Se vazio, usa hoje em America/Sao_Paulo."),
      }),
    },
    responses: {
      "200": {
        description: "Sincronizacao concluida",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              date: z.string(),
              summary: z.any(),
              results: z.array(z.any()),
            }),
          },
        },
      },
      "400": {
        description: "Data invalida",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              message: z.string(),
            }),
          },
        },
      },
      "500": {
        description: "Erro interno",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              message: z.string(),
            }),
          },
        },
      },
    },
  };

  async handle(c: Context<{ Bindings: Env }>) {
    try {
      const data = await this.getValidatedData<typeof this.schema>();
      const requestBody = await this.readOptionalJsonBody(c);
      const date = data.query.date ?? requestBody?.date ?? todayInSaoPaulo();

      if (!DATE_PATTERN.test(date)) {
        return c.json({ success: false, message: "date must be in YYYY-MM-DD format" }, 400);
      }

      const service = new SyncAuthorizationStatusService(c.env);
      const result = await service.sync(date);
      return c.json(result, 200);
    } catch (error: any) {
      console.error("[SyncAuthorizationStatus] Erro:", error);
      return c.json({ success: false, message: error?.message ?? String(error) }, 500);
    }
  }

  private async readOptionalJsonBody(c: Context<{ Bindings: Env }>): Promise<{ date?: string } | null> {
    const rawBody = await c.req.text().catch(() => "");
    if (!rawBody.trim()) return null;

    try {
      const parsed = JSON.parse(rawBody);
      return typeof parsed === "object" && parsed !== null ? parsed : null;
    } catch {
      return null;
    }
  }
}
