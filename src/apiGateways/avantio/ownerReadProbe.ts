import type { Env } from "../../types/configTypes";

type Check = {
  route: "detail" | "collection";
  status: number | null;
  response_kind: "object" | "array" | "empty" | "invalid" | "network_error";
  owner_id_matches: boolean;
  has_name_fields: boolean;
  record_keys: string[];
};

export type OwnerReadProbeReport = {
  owner_id: string;
  checks: Check[];
  /** Whether the provider returned a name for the exact requested owner ID. */
  owner_name_available: boolean;
};

type Fetcher = typeof fetch;
const NAME_KEYS = ["name", "fullName", "displayName", "firstName", "lastName", "surnames", "surname"];
const SAFE_KEYS = ["id", ...NAME_KEYS, "legalEntityId", "_links"];
const record = (x: unknown): Record<string, unknown> | null =>
  x !== null && typeof x === "object" && !Array.isArray(x)
    ? x as Record<string, unknown>
    : null;

function rowsFromPayload(raw: unknown): Record<string, unknown>[] {
  const root = record(raw);
  const data = root && "data" in root ? root.data : raw;
  const extracted = record(data);
  // Some APIs wrap a single entity in data.owner or data.owners.
  const nested = extracted?.owners ?? extracted?.owner;
  const candidate = nested ?? data;
  const array = Array.isArray(candidate) ? candidate : [candidate];
  return array.map(record).filter((item): item is Record<string, unknown> => item !== null);
}

function recordHasName(row: Record<string, unknown>) {
  return NAME_KEYS.some((key) => {
    const v = row[key];
    return (typeof v === "string" && v.trim().length > 0)
      || (Array.isArray(v) && v.some((s) => typeof s === "string" && s.trim().length > 0));
  });
}

function inspectBody(raw: unknown, ownerId: string) {
  const rows = rowsFromPayload(raw);
  const matching = rows.find((row) => String(row.id ?? "").trim() === ownerId);
  const first = matching ?? rows[0];
  return {
    response_kind: rows.length === 0 ? "empty" as const : Array.isArray(record(raw)?.data ?? raw) ? "array" as const : "object" as const,
    owner_id_matches: Boolean(matching),
    has_name_fields: first ? recordHasName(first) : false,
    record_keys: first ? SAFE_KEYS.filter((key) => Object.hasOwn(first, key)) : [],
    exact_name_available: Boolean(matching && recordHasName(matching)),
  };
}

/**
 * Bounded diagnostic, with no guessed arbitrary URL and no personal fields in
 * the response. 2 known candidate GETs only; it never creates or changes an
 * owner, and never returns provider response bodies or authentication data.
 */
export async function probeAvantioOwnerRead(
  env: Pick<Env, "AVANTIO_BASE_URL" | "AVANTIO_API_KEY">,
  ownerId: string,
  fetcher: Fetcher = fetch,
): Promise<OwnerReadProbeReport> {
  if (!/^\d{1,12}$/.test(ownerId)) throw new Error("invalid_owner_id");
  const baseUrl = env.AVANTIO_BASE_URL.replace(/\/+$/, "");
  const endpoints = [
    { route: "detail" as const, path: `/owners/${encodeURIComponent(ownerId)}` },
    { route: "collection" as const, path: "/owners?pagination_size=1" },
  ];
  const checks: Check[] = [];
  let nameAvailable = false;
  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetcher(`${baseUrl}${endpoint.path}`, {
        method: "GET",
        headers: { "X-Avantio-Auth": env.AVANTIO_API_KEY, "accept": "application/json" },
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") ?? "";
      let payload: unknown = null;
      if (response.ok && contentType.includes("json")) {
        try { payload = await response.json(); } catch { /* no raw body returned */ }
      }
      const inspected = payload == null
        ? { response_kind: "invalid" as const, owner_id_matches: false, has_name_fields: false, record_keys: [] as string[], exact_name_available: false }
        : inspectBody(payload, ownerId);
      nameAvailable ||= inspected.exact_name_available;
      checks.push({
        route: endpoint.route,
        status: response.status,
        response_kind: inspected.response_kind,
        owner_id_matches: inspected.owner_id_matches,
        has_name_fields: inspected.has_name_fields,
        record_keys: inspected.record_keys,
      });
      // No need to enumerate owners if the detail endpoint already resolved this one.
      if (nameAvailable || response.status === 401 || response.status === 403) break;
    } catch {
      checks.push({
        route: endpoint.route, status: null, response_kind: "network_error",
        owner_id_matches: false, has_name_fields: false, record_keys: [],
      });
    } finally {
      clearTimeout(timeout);
    }
  }
  return { owner_id: ownerId, checks, owner_name_available: nameAvailable };
}
