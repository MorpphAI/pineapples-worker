# Avantio accommodation boundary

The Worker exposes three globally `x-api-key`-protected endpoints:

- `POST /v1/avantio/accommodations/readiness`
- `POST /v1/avantio/accommodations/create`
- `POST /v1/avantio/accommodations/reconcile`

The PineOS-facing canonical schema version is `1`; the public Worker contract version is `worker-accommodation-v1`. Public examples live in `contracts/pineos-worker/v1` and contain no raw Avantio request or response payloads.

## Authoritative Worker findings

The authoritative read model is `AvantioAccommodation` in `src/types/avantioTypes.ts`. It contains `id`, `galleryId`, `name`, `status`, `area`, and `location`. It does not contain a verified external property reference. The existing `AvantioApiGateway.getAccommodations()` method lists all pages and `getAccommodation()` reads details using `X-Avantio-Auth` and `AVANTIO_BASE_URL`.

No accommodation create-request model, create method, provider error type, bounded timeout, provider request-ID extraction, or exact external-reference field exists in the current Worker. Those facts are not inferred from historical systems.

Consequently:

- readiness validates CanonicalPropertyV1, rejects sensitive keys, maps only fields found in the read model, and returns explicit provider-model/reference gaps;
- reconciliation does not call Avantio and reports `external_reference_field_unavailable`;
- create defaults to `create_disabled` and never calls Avantio;
- no payload hash is returned until an authoritative create request can be built.

## Configuration

Required bindings remain `API_KEY`, `AVANTIO_API_KEY`, `AVANTIO_BASE_URL`, and `DB`. `AVANTIO_ACCOMMODATION_CREATE_ENABLED` is enabled only when its normalized value equals `true`; repository default remains `false`.

Do not enable creation until the current Worker model authoritatively defines:

1. the accommodation create request and required enums;
2. the exact response field preserving `identification.code`;
3. create response external-ID semantics;
4. normalized provider errors, timeouts, request IDs, and transmission lifecycle.

An uncertain write must never be retried blindly. No complete provider payload, API key, incoming API key, or authorization header may be logged.
