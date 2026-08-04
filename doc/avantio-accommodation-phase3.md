# Avantio accommodation boundary

The globally `x-api-key`-protected endpoints are:

- `POST /v1/avantio/accommodations/readiness`
- `POST /v1/avantio/accommodations/create`
- `POST /v1/avantio/accommodations/reconcile`

Canonical schema version is `1`; public contract version is `worker-accommodation-v1`. Public examples live in `contracts/pineos-worker/v1` and never expose raw provider payloads.

## Evidence and implemented contract

The existing Worker remains authoritative for `AVANTIO_BASE_URL`, `X-Avantio-Auth`, pagination through `_links.next`, the `data` envelope, and accommodation reads. Connected production migration evidence verifies:

- `POST {AVANTIO_BASE_URL}/accommodations`;
- `externalReference` as the create-side PineOS property code;
- `status=ENABLED`, `purpose=RENTAL`, `capacity.min=1`;
- apartment `APARTMENT`, queen bed `QUEENSIZE`, gas cooktop `GAS`, bedroom `BEDROOM`, and service `INTERNET_ACCESS`;
- creation success requires a non-empty `response.data.id`.

The Worker-owned Zod create contract and deterministic mapper are in `src/integrations/avantio/accommodations`. Other property, bed, and cooktop mappings are explicitly migration-derived and produce readiness warnings. Unsupported values produce `unsupported_provider_mapping`; no enum is silently substituted.

## Exact lookup and diagnostic

`AvantioAccommodation` preserves optional top-level `externalReference`, `registryData`, and unknown raw fields. Lookup compares top-level `externalReference` with canonical `identification.code` using case-sensitive equality and the existing paginated `getAccommodations()` method. It does not use names, addresses, substrings, or `registryData.registerReference`.

`summarizeAccommodationReferencePresence()` reports only aggregate counts for top-level and registry reference-field presence. No live raw production sample was fetched in this task, so current production coverage of `externalReference` remains an operational fact to measure with that diagnostic; the selected lookup field is based on the connected successful create request.

## Creation and uncertainty

Create validates and hashes the provider request, performs exact lookup, returns `found_existing` or `conflict` without POST, checks the feature flag after zero matches, and invokes the existing gateway POST exactly once only when enabled. Received HTTP errors are definite outcomes. A network failure after fetch begins is `uncertain` and is never retried automatically. Malformed responses and 2xx responses without `data.id` are not successful.

`AVANTIO_ACCOMMODATION_CREATE_ENABLED` remains `false` in repository configuration. Readiness and reconciliation work while disabled. A controlled create requires the flag to be enabled only after read-side `externalReference` presence has been confirmed in the target Avantio account.
