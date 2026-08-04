export type AvantioTransportStage = "not_started" | "request_built" | "fetch_invoked" | "response_received" | "body_received";
export type AvantioProviderErrorKind = "provider_rejected" | "temporarily_unavailable" | "uncertain" | "invalid_provider_response";

export class AvantioProviderError extends Error {
  constructor(
    public readonly kind: AvantioProviderErrorKind,
    public readonly code: string,
    message: string,
    public readonly stage: AvantioTransportStage,
    public readonly status: number | null = null,
    public readonly providerRequestId: string | null = null,
  ) {
    super(message);
    this.name = "AvantioProviderError";
  }
}

export function classifyReceivedStatus(status: number): AvantioProviderErrorKind {
  if (status === 429 || status >= 500) return "temporarily_unavailable";
  return "provider_rejected";
}
