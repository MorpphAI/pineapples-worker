import { Env } from "../../types/configTypes";

export type AuthorizationSyncStatus = "out" | "tim";

export type AuthorizationSyncPayload = {
  accommodationId: string;
  propertyCode?: string | null;
  targetDate: string;
  authorizationStatus: AuthorizationSyncStatus;
  payload: Record<string, unknown>;
};

export type AuthorizationSyncResult = {
  status: "updated" | "unchanged" | "skipped" | "error";
  reason?: string;
  card_id?: string;
  accommodation_id?: string;
  previous_status?: string | null;
  new_status?: string | null;
};

export class PineOSKanbanAuthorizationClient {
  private readonly url: string;
  private readonly secret: string;

  constructor(env: Env) {
    this.url = env.PINEOS_KANBAN_AUTH_SYNC_URL;
    this.secret = env.PINEOS_KANBAN_AUTH_SYNC_SECRET;

    if (!this.url) throw new Error("PINEOS_KANBAN_AUTH_SYNC_URL is not configured");
    if (!this.secret) throw new Error("PINEOS_KANBAN_AUTH_SYNC_SECRET is not configured");
  }

  async syncAuthorization(input: AuthorizationSyncPayload): Promise<AuthorizationSyncResult> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "x-kanban-auth-sync-secret": this.secret,
      },
      body: JSON.stringify({
        accommodationId: input.accommodationId,
        propertyCode: input.propertyCode ?? null,
        targetDate: input.targetDate,
        authorizationStatus: input.authorizationStatus,
        authorizationSource: "avantio-status-sync",
        payload: input.payload,
      }),
    });

    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
    }

    if (!response.ok) {
      throw new Error(`PineOS authorization sync failed: ${response.status} ${text}`);
    }

    return parsed as AuthorizationSyncResult;
  }
}
