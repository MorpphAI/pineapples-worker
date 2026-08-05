export const AVANTIO_PROVIDER_ERROR_MAX_BODY_BYTES = 64 * 1024;
export const AVANTIO_PROVIDER_ERROR_MAX_DEPTH = 8;
export const AVANTIO_PROVIDER_ERROR_MAX_ISSUES = 20;
export const AVANTIO_PROVIDER_ERROR_MAX_MESSAGE_LENGTH = 500;
export const AVANTIO_PROVIDER_ERROR_MAX_CODE_LENGTH = 100;
export const AVANTIO_PROVIDER_ERROR_MAX_PATH_LENGTH = 250;

export type AvantioProviderIssue = {
  code: string;
  message: string;
  canonical_path: null;
  provider_path: string | null;
  section: "provider";
};

const CONTAINER_KEYS = new Set(["errors", "error", "validationerrors", "violations", "issues", "details"]);
const PATH_KEYS = ["field", "path", "property", "parameter", "pointer"];
const MESSAGE_KEYS = ["message", "detail", "description", "title", "error"];
const CODE_KEYS = ["code", "type", "errorcode"];
const SENSITIVE_KEY = /(?:authorization|cookie|token|api[_\s-]?key|secret|password|credential|wifi|lock|owner)/i;
const SENSITIVE_VALUE = /(?:\b(?:bearer|basic)\s+\S+|\b(?:authorization|cookie|token|api[_\s-]?key|secret|password|credential)\s*[:=]\s*\S+|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/i;
const HTML = /<!doctype\s+html|<html\b|<body\b|<script\b|<[^>]+>/i;
const STACK_TRACE = /(?:\bstack\s*trace\b|\btraceback\b|(?:^|\s)at\s+[^\s]+\s*\([^)]*:\d+:\d+\))/i;

function boundedUtf8Text(value: string): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= AVANTIO_PROVIDER_ERROR_MAX_BODY_BYTES) return value;
  return new TextDecoder().decode(bytes.slice(0, AVANTIO_PROVIDER_ERROR_MAX_BODY_BYTES));
}

function normalizedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized || HTML.test(normalized) || STACK_TRACE.test(normalized) || SENSITIVE_VALUE.test(normalized)) return null;
  return normalized.slice(0, maxLength).trim() || null;
}

function providerPath(value: unknown): string | null {
  const normalized = normalizedText(value, AVANTIO_PROVIDER_ERROR_MAX_PATH_LENGTH);
  return normalized && !SENSITIVE_KEY.test(normalized) ? normalized : null;
}

function issueCode(value: unknown): string {
  const normalized = normalizedText(value, AVANTIO_PROVIDER_ERROR_MAX_CODE_LENGTH);
  if (!normalized || SENSITIVE_KEY.test(normalized)) return "provider_validation_error";
  const safe = normalized.toLowerCase().replace(/[^a-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  if (!safe) return "provider_validation_error";
  const prefixed = safe.startsWith("provider_") ? safe : `provider_${safe}`;
  return prefixed.slice(0, AVANTIO_PROVIDER_ERROR_MAX_CODE_LENGTH).replace(/[_-]+$/g, "") || "provider_validation_error";
}

function firstValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const matching = Object.keys(record).find((candidate) => candidate.toLowerCase() === key);
    if (matching && record[matching] !== undefined && record[matching] !== null) return record[matching];
  }
  return undefined;
}

function directProviderPath(record: Record<string, unknown>): string | null {
  const direct = providerPath(firstValue(record, PATH_KEYS));
  if (direct) return direct;
  const source = Object.keys(record).find((key) => key.toLowerCase() === "source");
  if (!source || !record[source] || typeof record[source] !== "object" || Array.isArray(record[source])) return null;
  return providerPath(firstValue(record[source] as Record<string, unknown>, ["pointer"]));
}

export function parseAvantioProviderError(body: string): AvantioProviderIssue[] {
  const bounded = boundedUtf8Text(body);
  const trimmed = bounded.trim();
  if (!trimmed || HTML.test(trimmed)) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  const issues: AvantioProviderIssue[] = [];
  const seen = new Set<string>();

  const visit = (value: unknown, depth: number): void => {
    if (depth > AVANTIO_PROVIDER_ERROR_MAX_DEPTH || issues.length >= AVANTIO_PROVIDER_ERROR_MAX_ISSUES) return;
    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry, depth + 1);
        if (issues.length >= AVANTIO_PROVIDER_ERROR_MAX_ISSUES) break;
      }
      return;
    }
    if (!value || typeof value !== "object") return;

    const record = value as Record<string, unknown>;
    const message = normalizedText(firstValue(record, MESSAGE_KEYS), AVANTIO_PROVIDER_ERROR_MAX_MESSAGE_LENGTH);
    const path = directProviderPath(record);
    if (message && !(path === null && Object.keys(record).some((key) => SENSITIVE_KEY.test(key)))) {
      const code = issueCode(firstValue(record, CODE_KEYS));
      const dedupeKey = `${code}\u0000${path ?? ""}\u0000${message}`;
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        issues.push({ code, message, canonical_path: null, provider_path: path, section: "provider" });
      }
    }

    if (issues.length >= AVANTIO_PROVIDER_ERROR_MAX_ISSUES) return;
    for (const [key, child] of Object.entries(record)) {
      if (!CONTAINER_KEYS.has(key.toLowerCase()) || typeof child === "string") continue;
      visit(child, depth + 1);
      if (issues.length >= AVANTIO_PROVIDER_ERROR_MAX_ISSUES) break;
    }
  };

  visit(parsed, 0);
  return issues;
}
