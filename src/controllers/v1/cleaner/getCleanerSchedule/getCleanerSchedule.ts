import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { Env } from "../../../../types/configTypes";
import { GetCleanerScheduleService } from "../../../../services/v1/cleaner/getCleanerSchedule/getCleanerScheduleService";

export class GetCleanerSchedule extends OpenAPIRoute {
    schema = {
        tags: ["Cleaners"],
        summary: "Escala do dia de uma faxineira",
        description: "Retorna as tarefas alocadas para uma faxineira em uma data específica.",
        request: {
            params: z.object({
                id: z.string().describe("ID da faxineira"),
            }),
            query: z.object({
                date: z.string().date().optional().describe("Data (YYYY-MM-DD). Se vazio, usa HOJE."),
            }),
        },
        responses: {
            "200": {
                description: "Escala encontrada",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            cleanerId: z.number(),
                            cleanerName: z.string(),
                            date: z.string(),
                            taskCount: z.number(),
                            tasks: z.array(z.object({
                                timeRange: z.string(),
                                accommodation: z.string(),
                                type: z.string(),
                                address: z.string(),
                                zone: z.string(),
                                stayDuration: z.number().nullable(),
                            })),
                        }),
                    },
                },
            },
            "400": {
                description: "ID inválido",
                content: { "application/json": { schema: z.object({ success: z.boolean(), error: z.string() }) } },
            },
            "404": {
                description: "Faxineira não encontrada",
                content: { "application/json": { schema: z.object({ success: z.boolean(), error: z.string() }) } },
            },
            "500": {
                description: "Erro interno",
                content: { "application/json": { schema: z.object({ success: z.boolean(), error: z.string() }) } },
            },
        },
    };

    async handle(c: Context<{ Bindings: Env }>) {
        const { id } = c.req.param();
        const parsedId = parseInt(id, 10);

        if (isNaN(parsedId)) {
            return c.json({ success: false, error: "ID inválido." }, 400);
        }

        const data = await this.getValidatedData<typeof this.schema>();
        const today = new Date().toISOString().split("T")[0];
        const targetDate = data.query.date || today;

        const service = new GetCleanerScheduleService(c.env);

        try {
            const result = await service.getSchedule(parsedId, targetDate);

            if (!result) {
                return c.json({ success: false, error: "Faxineira não encontrada." }, 404);
            }

            return c.json({
                success: true,
                cleanerId: result.cleanerId,
                cleanerName: result.cleanerName,
                date: result.date,
                taskCount: result.tasks.length,
                tasks: result.tasks,
            }, 200);
        } catch (e: any) {
            console.error(e);
            return c.json({ success: false, error: e.message }, 500);
        }
    }
}
