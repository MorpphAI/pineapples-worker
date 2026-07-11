import { OpenAPIRoute } from "chanfana";
import { Context } from "hono";

export class RemovedKanbanAuthorizationSync extends OpenAPIRoute {
  schema = {
    tags: ["Kanban"],
    summary: "Removed PineOS authorization synchronization endpoint",
    responses: {
      "410": {
        description: "The PineOS authorization integration was removed",
      },
    },
  };

  async handle(c: Context) {
    return c.json({
      success: false,
      reason: "pineos_authorization_integration_removed",
      replacement: "/v1/cange/authorization-decisions",
    }, 410);
  }
}
