import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Env } from "../../../../types/configTypes";
import { ScaleService } from "../../../../services/v1/scale/createScale/PostScaleService";
import { Context } from "hono";
import { normalizeCleaningProfiles } from "../../../../utils/scaleUtils";

export class CreateScales extends OpenAPIRoute { 
   schema = {
           tags: ["Scales"],
            summary: "Gerar Escala de Limpeza Diária",
            description: "Gera a escala e retorna o ID e o Link para download.",
            request: {
                query: z.object({
                    date: z.string().date().optional(),
                }),
            },
            responses: {
                "201": {
                    description: "Escala gerada com sucesso",
                    content: {
                        "application/json": {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                                runId: z.number(),
                                downloadUrl: z.string().describe("Link direto para baixar o Excel"),
                                summary: z.any().optional()
                            }),
                        },
                    },
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
            },
    };

    async handle(c: Context<{ Bindings: Env }>) {
        
        const data = await this.getValidatedData<typeof this.schema>();
        
        const today = new Date().toISOString().split("T")[0];

        const targetDate = data.query.date || today;

        try {
            const rawBody = await c.req.text().catch(() => "");
            let requestBody: any = {};
            const warnings: string[] = [];

            if (rawBody.trim()) {
                try {
                    requestBody = JSON.parse(rawBody);
                } catch {
                    warnings.push("Body JSON invalido ignorado; escala gerada com comportamento fallback.");
                }
            }

            const normalizedProfiles = normalizeCleaningProfiles(requestBody?.cleaningProfiles);
            
            const scaleService = new ScaleService(c.env);
            const result = await scaleService.generateDailySchedule(
                targetDate,
                { cleaningProfiles: normalizedProfiles.profiles },
                [...warnings, ...normalizedProfiles.warnings]
            );

            const url = new URL(c.req.url);
            const localDownloadLink = `${url.origin}/v1/scale/${result.runId}/export`;

            return c.json({
                success: true,
                message: `Escala gerada para o dia ${targetDate}`,
                runId: result.runId,
                downloadUrl: localDownloadLink,
                summary: result.summary,
            }, 201);
            
        } catch (error: any) {
            console.error(error);
            return c.json({ status: "error", message: error.message }, 500);
        }
    }
}
