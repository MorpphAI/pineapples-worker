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

export type AvantioProviderErrorParserMetadata = {
  parsed_json: boolean;
  top_level_shape: "object" | "array" | null;
  recognized_container_keys: string[];
  validation_nodes_seen: number;
  constraint_nodes_seen: number;
  child_nodes_seen: number;
  validation_map_nodes_seen: number;
  validation_map_candidate_keys_seen: number;
  validation_map_string_leaves_seen: number;
  validation_map_string_array_leaves_seen: number;
  validation_map_rule_maps_seen: number;
  validation_map_nested_maps_seen: number;
  ignored_sensitive_keys_seen: number;
  ignored_unsupported_leaves_seen: number;
  details_object_count: number;
  details_array_count: number;
  details_string_count: number;
  extracted_issue_count: number;
};

export type AvantioProviderErrorParseResult = {
  issues: AvantioProviderIssue[];
  metadata: AvantioProviderErrorParserMetadata;
};

const RECOGNIZED_KEY_NAMES = ["errors", "error", "validationErrors", "violations", "issues", "details", "children", "constraints", "message"] as const;
const RECOGNIZED_KEYS = new Map(RECOGNIZED_KEY_NAMES.map((key) => [key.toLowerCase(), key]));
const CONTAINER_KEYS = new Set(["errors", "error", "validationerrors", "violations", "issues", "details", "children"]);
const VALIDATION_MAP_CONTAINER_KEYS = new Set(["details", "errors", "validationerrors", "violations", "issues"]);
const VALIDATION_MAP_DENIED_KEYS = new Set([
  "target", "value", "request", "response", "body", "payload", "input", "data", "context", "metadata", "meta",
  "headers", "authorization", "cookie", "token", "apikey", "api_key", "secret", "password", "credential", "stack",
  "trace", "cause",
]);
const EXPLICIT_PATH_KEYS = ["field", "path", "parameter", "pointer"];
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

function explicitProviderPath(record: Record<string, unknown>): string | null {
  const direct = providerPath(firstValue(record, EXPLICIT_PATH_KEYS));
  if (direct) return direct;
  const source = Object.keys(record).find((key) => key.toLowerCase() === "source");
  if (!source || !record[source] || typeof record[source] !== "object" || Array.isArray(record[source])) return null;
  return providerPath(firstValue(record[source] as Record<string, unknown>, ["pointer"]));
}

function hasExplicitProviderPath(record: Record<string, unknown>): boolean {
  if (firstValue(record, EXPLICIT_PATH_KEYS) !== undefined) return true;
  const source = Object.keys(record).find((key) => key.toLowerCase() === "source");
  return !!source
    && !!record[source]
    && typeof record[source] === "object"
    && !Array.isArray(record[source])
    && firstValue(record[source] as Record<string, unknown>, ["pointer"]) !== undefined;
}

function propertySegment(value: unknown): string | null {
  const normalized = normalizedText(value, AVANTIO_PROVIDER_ERROR_MAX_PATH_LENGTH);
  if (!normalized || SENSITIVE_KEY.test(normalized)) return null;
  if (/^\d+$/.test(normalized)) return normalized;
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(normalized) ? normalized : null;
}

function appendPropertyPath(parent: string | null, segment: string): string | null {
  const candidate = /^\d+$/.test(segment)
    ? parent ? `${parent}[${segment}]` : segment
    : parent ? `${parent}.${segment}` : segment;
  return providerPath(candidate);
}

function normalizeMapKeyPath(value: string): string | null {
  const normalized = normalizedText(value, AVANTIO_PROVIDER_ERROR_MAX_PATH_LENGTH);
  if (!normalized || SENSITIVE_KEY.test(normalized)) return null;
  if (/^\d+$/.test(normalized)) return normalized;

  if (normalized.startsWith("/")) {
    const segments = normalized.split("/").slice(1);
    if (segments.length === 0 || segments.some((segment) => !/^(?:\d+|[A-Za-z_][A-Za-z0-9_-]*)$/.test(segment))) return null;
    return segments.reduce<string | null>((path, segment) => path === null ? segment : appendPropertyPath(path, segment), null);
  }

  return /^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*|\[\d+\])*$/.test(normalized)
    ? normalized
    : null;
}

function appendMapPath(parent: string | null, key: string): string | null {
  const normalized = normalizeMapKeyPath(key);
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) return appendPropertyPath(parent, normalized);
  return parent ? providerPath(`${parent}.${normalized}`) : providerPath(normalized);
}

function isDeniedMapKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  const segments = normalized.replace(/\[(\d+)\]/g, ".$1").split(/[./]/).filter(Boolean);
  return segments.some((segment) => VALIDATION_MAP_DENIED_KEYS.has(segment)) || SENSITIVE_KEY.test(key);
}

function isRuleIdentifier(key: string): boolean {
  return key.length <= 64 && (
    /^is[A-Z][A-Za-z0-9]*$/.test(key)
    || /^(?:min|max|minLength|maxLength|required|enum|pattern|format|invalid)$/.test(key)
  );
}

function isRuleMap(record: Record<string, unknown>): boolean {
  const entries = Object.entries(record);
  return entries.length > 0 && entries.every(([key, value]) => typeof value === "string" && isRuleIdentifier(key));
}

function normalizedMapMessage(value: unknown): string | null {
  const message = normalizedText(value, AVANTIO_PROVIDER_ERROR_MAX_MESSAGE_LENGTH);
  if (!message) return null;
  if (/^(?:[A-Fa-f0-9]{128,}|[A-Za-z0-9+/]{128,}={0,2})$/.test(message)) return null;
  return message;
}

function emptyMetadata(): AvantioProviderErrorParserMetadata {
  return {
    parsed_json: false,
    top_level_shape: null,
    recognized_container_keys: [],
    validation_nodes_seen: 0,
    constraint_nodes_seen: 0,
    child_nodes_seen: 0,
    validation_map_nodes_seen: 0,
    validation_map_candidate_keys_seen: 0,
    validation_map_string_leaves_seen: 0,
    validation_map_string_array_leaves_seen: 0,
    validation_map_rule_maps_seen: 0,
    validation_map_nested_maps_seen: 0,
    ignored_sensitive_keys_seen: 0,
    ignored_unsupported_leaves_seen: 0,
    details_object_count: 0,
    details_array_count: 0,
    details_string_count: 0,
    extracted_issue_count: 0,
  };
}

export function parseAvantioProviderErrorWithMetadata(body: string): AvantioProviderErrorParseResult {
  const metadata = emptyMetadata();
  const bounded = boundedUtf8Text(body);
  const trimmed = bounded.trim();
  if (!trimmed || HTML.test(trimmed)) return { issues: [], metadata };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { issues: [], metadata };
  }

  metadata.parsed_json = true;
  metadata.top_level_shape = Array.isArray(parsed) ? "array" : parsed && typeof parsed === "object" ? "object" : null;

  const issues: AvantioProviderIssue[] = [];
  const seen = new Set<string>();
  const recognized = new Set<string>();

  const addIssue = (codeValue: unknown, messageValue: unknown, path: string | null): void => {
    if (issues.length >= AVANTIO_PROVIDER_ERROR_MAX_ISSUES) return;
    const message = normalizedText(messageValue, AVANTIO_PROVIDER_ERROR_MAX_MESSAGE_LENGTH);
    if (!message) return;
    const code = issueCode(codeValue);
    const dedupeKey = `${code}\u0000${path ?? ""}\u0000${message}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    issues.push({ code, message, canonical_path: null, provider_path: path, section: "provider" });
  };

  const addMapIssue = (codeValue: unknown, messageValue: unknown, path: string | null): void => {
    if (issues.length >= AVANTIO_PROVIDER_ERROR_MAX_ISSUES) return;
    const message = normalizedMapMessage(messageValue);
    if (!message) {
      metadata.ignored_unsupported_leaves_seen += 1;
      return;
    }
    metadata.validation_map_string_leaves_seen += 1;
    addIssue(codeValue, message, path);
  };

  const visitMapValue = (value: unknown, depth: number, path: string | null, fromStringArray = false): void => {
    if (depth > AVANTIO_PROVIDER_ERROR_MAX_DEPTH || issues.length >= AVANTIO_PROVIDER_ERROR_MAX_ISSUES) return;
    if (typeof value === "string") {
      addMapIssue(undefined, value, path);
      return;
    }
    if (Array.isArray(value)) {
      const hasStrings = value.some((entry) => typeof entry === "string");
      if (hasStrings && !fromStringArray) metadata.validation_map_string_array_leaves_seen += 1;
      for (const entry of value) {
        visitMapValue(entry, depth + (Array.isArray(entry) ? 1 : 0), path, hasStrings || fromStringArray);
        if (issues.length >= AVANTIO_PROVIDER_ERROR_MAX_ISSUES) break;
      }
      return;
    }
    if (!value || typeof value !== "object") {
      metadata.ignored_unsupported_leaves_seen += 1;
      return;
    }

    const record = value as Record<string, unknown>;
    if (isRuleMap(record)) {
      metadata.validation_map_nodes_seen += 1;
      metadata.validation_map_rule_maps_seen += 1;
      for (const [rule, message] of Object.entries(record)) {
        addMapIssue(rule, message, path);
        if (issues.length >= AVANTIO_PROVIDER_ERROR_MAX_ISSUES) break;
      }
      return;
    }
    metadata.validation_map_nested_maps_seen += 1;
    visit(value, depth + 1, path, false, true);
  };

  const visitValidationMap = (record: Record<string, unknown>, depth: number, parentPath: string | null): void => {
    metadata.validation_map_nodes_seen += 1;
    for (const [key, child] of Object.entries(record)) {
      if (issues.length >= AVANTIO_PROVIDER_ERROR_MAX_ISSUES) break;
      if (isDeniedMapKey(key)) {
        metadata.ignored_sensitive_keys_seen += 1;
        continue;
      }
      metadata.validation_map_candidate_keys_seen += 1;
      const path = appendMapPath(parentPath, key);
      if (!path) {
        metadata.ignored_unsupported_leaves_seen += 1;
        continue;
      }
      visitMapValue(child, depth, path);
    }
  };

  function visit(value: unknown, depth: number, parentPath: string | null, fromChildren = false, validationMapMode = false): void {
    if (depth > AVANTIO_PROVIDER_ERROR_MAX_DEPTH || issues.length >= AVANTIO_PROVIDER_ERROR_MAX_ISSUES) return;
    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry, depth + (Array.isArray(entry) ? 1 : 0), parentPath, fromChildren, validationMapMode);
        if (issues.length >= AVANTIO_PROVIDER_ERROR_MAX_ISSUES) break;
      }
      return;
    }
    if (!value || typeof value !== "object") return;

    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const recognizedName = RECOGNIZED_KEYS.get(key.toLowerCase());
      if (recognizedName) recognized.add(recognizedName);
      if (key.toLowerCase() === "details") {
        const details = record[key];
        if (Array.isArray(details)) metadata.details_array_count += 1;
        else if (details && typeof details === "object") metadata.details_object_count += 1;
        else if (typeof details === "string") metadata.details_string_count += 1;
      }
    }

    const propertyKey = Object.keys(record).find((key) => key.toLowerCase() === "property");
    const constraintsKey = Object.keys(record).find((key) => key.toLowerCase() === "constraints");
    const childrenKey = Object.keys(record).find((key) => key.toLowerCase() === "children");
    if (propertyKey || constraintsKey || childrenKey) metadata.validation_nodes_seen += 1;
    if (fromChildren) metadata.child_nodes_seen += 1;

    const explicitPathSupplied = hasExplicitProviderPath(record);
    const explicitPath = explicitProviderPath(record);
    const rawProperty = propertyKey ? record[propertyKey] : undefined;
    const segment = propertySegment(rawProperty);
    const propertyRejected = (explicitPathSupplied && explicitPath === null)
      || (!explicitPathSupplied && rawProperty !== undefined && segment === null);
    const path = explicitPathSupplied ? explicitPath : segment ? appendPropertyPath(parentPath, segment) : parentPath;

    const message = firstValue(record, MESSAGE_KEYS);
    const hasRecognizedContainer = Object.keys(record).some((key) => CONTAINER_KEYS.has(key.toLowerCase()));
    const structuredFormat = explicitPathSupplied || propertyKey !== undefined || constraintsKey !== undefined
      || childrenKey !== undefined || message !== undefined || hasRecognizedContainer;
    if (validationMapMode && !structuredFormat) {
      visitValidationMap(record, depth, parentPath);
      return;
    }

    if (!propertyRejected && !(path === null && Object.keys(record).some((key) => SENSITIVE_KEY.test(key)))) {
      addIssue(firstValue(record, CODE_KEYS), message, path);
    }

    if (constraintsKey && record[constraintsKey] && typeof record[constraintsKey] === "object" && !Array.isArray(record[constraintsKey])) {
      metadata.constraint_nodes_seen += 1;
      if (!propertyRejected) {
        for (const [constraintCode, constraintMessage] of Object.entries(record[constraintsKey] as Record<string, unknown>)) {
          if (typeof constraintMessage !== "string") continue;
          addIssue(constraintCode, constraintMessage, path);
          if (issues.length >= AVANTIO_PROVIDER_ERROR_MAX_ISSUES) break;
        }
      }
    }

    if (issues.length >= AVANTIO_PROVIDER_ERROR_MAX_ISSUES) return;
    for (const [key, child] of Object.entries(record)) {
      const normalizedKey = key.toLowerCase();
      if (!CONTAINER_KEYS.has(normalizedKey) || typeof child === "string") continue;
      if (normalizedKey === "children" && propertyRejected) continue;
      visit(child, depth + 1, path, normalizedKey === "children", VALIDATION_MAP_CONTAINER_KEYS.has(normalizedKey));
      if (issues.length >= AVANTIO_PROVIDER_ERROR_MAX_ISSUES) break;
    }
  }

  visit(parsed, 0, null);
  metadata.recognized_container_keys = RECOGNIZED_KEY_NAMES.filter((key) => recognized.has(key));
  metadata.extracted_issue_count = issues.length;
  return { issues, metadata };
}

export function parseAvantioProviderError(body: string): AvantioProviderIssue[] {
  return parseAvantioProviderErrorWithMetadata(body).issues;
}
