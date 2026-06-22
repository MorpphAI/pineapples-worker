import { Env } from "../../types/configTypes";

export type AuthorizationSyncStatus = "out" | "tim";

export type AuthorizationSyncPayload = {
  accommodationId: string;
  propertyCode?: string | null;
  targetDate: string;
  authorizationStatus: AuthorizationSyncStatus;
  payload: Record<string, unknown>;
};

export type AuthorizationSyncRpcResult = {
  status: "updated" | "unchanged" | "skipped" | "error";
  reason?: string;
  card_id?: string;
  accommodation_id?: string;
  previous_status?: string | null;
  new_status?: string | null;
};

export class SupabaseKanbanRepository {
  private readonly supabaseUrl: string;
  private readonly serviceRoleKey: string;

  constructor(env: Env) {
    this.supabaseUrl = env.SUPABASE_URL?.replace(/\/$/, "");
    this.serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

    if (!this.supabaseUrl) throw new Error("SUPABASE_URL is not configured");
    if (!this.serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }

  async syncAuthorization(input: AuthorizationSyncPayload): Promise<AuthorizationSyncRpcResult> {
    const response = await fetch(`${this.supabaseUrl}/rest/v1/rpc/sync_card_authorization_from_worker`, {
      method: "POST",
      headers: {
        "apikey": this.serviceRoleKey,
        "Authorization": `Bearer ${this.serviceRoleKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        p_accommodation_id: input.accommodationId,
        p_property_code: input.propertyCode ?? null,
        p_target_date: input.targetDate,
        p_authorization_status: input.authorizationStatus,
        p_authorization_source: "avantio-status-sync",
        p_payload: input.payload,
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
      throw new Error(`Supabase authorization sync failed: ${response.status} ${text}`);
    }

    return parsed as AuthorizationSyncRpcResult;
  }
}
