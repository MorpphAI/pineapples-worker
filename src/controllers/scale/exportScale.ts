import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { Env } from "../../types/configTypes";
import { ReportService } from "../../services/scale/reportService";

export class ExportScale extends OpenAPIRoute {
    schema = {
        tags: ["Scales"],
        summary: "Baixar Excel da Escala",
        description: "Gera e baixa o arquivo .xlsx de uma escala salva anteriormente pelo ID de execução.",
        request: {
            params: z.object({
                id: z.string().describe("ID da execução (runId) retornado na geração")
            })
        },
        responses: {
            "200": {
                description: "Arquivo Excel para Download",
                content: {
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
                        schema: z.string().openapi({ format: "binary" })
                    }
                }
            },
            "404": {
                description: "Escala não encontrada ou vazia",
                content: {
                    "application/json": {
                        schema: z.object({
                            error: z.string()
                        })
                    }
                }
            },
            "500": {
                description: "Erro interno",
                content: {
                    "application/json": {
                        schema: z.object({
                            status: z.string(),
                            message: z.string()
                        })
                    }
                }
            }
        }
    };

    async handle(c: Context<{ Bindings: Env }>) {

        const data = await this.getValidatedData<typeof this.schema>();

        const runId = parseInt(data.params.id);

        if (isNaN(runId)) {
            return c.json({ error: "ID inválido" }, 400);
        }

        try {
            const reportService = new ReportService(c.env);
            const fileBuffer = await reportService.getScaleReportFile(runId);

            if (!fileBuffer) {
                return c.json({ error: "Escala não encontrada ou vazia" }, 404);
            }

            return new Response(fileBuffer, {
                headers: {
                    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "Content-Disposition": `attachment; filename="escala_limpeza_${runId}.xlsx"`,
                    "Content-Length": fileBuffer.length.toString()
                }
            });

        } catch (error: any) {
            console.error("[ExportScale] Erro:", error);
            return c.json({ status: "error", message: error.message }, 500);
        }
    }
}