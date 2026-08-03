export function sanitizeProviderText(value: unknown): string | null { return typeof value === "string" ? value.slice(0, 500) : null; }
