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

## Incremental index and exact lookup

The former request-time lookup paginated the entire Avantio accommodation catalog and hydrated missing references in one Worker invocation. Production catalog size exceeded Cloudflare's per-invocation subrequest limit, so synchronization and duplicate prevention could fail before reaching a safe zero-match conclusion.

`POST /v1/accommodations/sync` now builds an immutable D1 reference-index generation incrementally. Each authenticated call fetches exactly one Avantio list page with `pagination_size=10`, performs at most one detail GET per returned record, updates the existing `accommodations` cache, and saves the provider cursor internally. The hard application ceiling is 20 provider requests per invocation; a normal full page therefore uses at most 11. Call the endpoint repeatedly until it returns `complete=true`, `active_generation_available=true`, and `building=false`.

The active generation is replaced only after the final page is stored successfully. A failed or partial generation remains separate, and any previous active generation is retained. Records use only `id`, `accommodationId`, or `accommodation_id`; `galleryId` is never accepted by the strict index.

Create and reconcile query only the active D1 generation using case-sensitive `external_reference` equality. Positive matches receive one bounded live detail verification each. Names, addresses, substrings, fuzzy matching, and `registryData.registerReference` are not used. Missing, incomplete, inconsistent, or stale index state returns `accommodation_index_refresh_required` and cannot authorize a provider POST.

The freshness threshold is configured by `AVANTIO_ACCOMMODATION_INDEX_MAX_AGE_SECONDS` and defaults to 900 seconds. A full incremental refresh must be completed immediately before a controlled production creation.

## Creation and uncertainty

Create validates and hashes the provider request, performs exact lookup, returns `found_existing` or `conflict` without POST, checks the feature flag after zero matches, and invokes the existing gateway POST exactly once only when enabled. Received HTTP errors are definite outcomes. A network failure after fetch begins is `uncertain` and is never retried automatically. Malformed responses and 2xx responses without `data.id` are not successful.

`AVANTIO_ACCOMMODATION_CREATE_ENABLED` remains `false` in repository configuration. Readiness remains provider-independent; reconciliation requires a fresh completed index. Before a controlled create: apply D1 migration `0007`, repeatedly call `/v1/accommodations/sync` until complete, confirm the generation is fresh, then deliberately enable creation in a separate operational change. Creation is not enabled by this implementation.
