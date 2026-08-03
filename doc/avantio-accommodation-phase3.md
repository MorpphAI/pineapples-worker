# Avantio accommodation Phase 3

Phase 3 exposes authenticated (`x-api-key`) JSON endpoints:

- `POST /v1/avantio/accommodations/readiness`
- `POST /v1/avantio/accommodations/create`
- `POST /v1/avantio/accommodations/reconcile`

All use canonical schema version `1`, snake_case fields, UUID request/property IDs and a positive canonical property code. Sensitive field names (including credentials, banking data, owner data and prebuilt Avantio payloads) are rejected recursively. Nullable booleans are tri-state: `null` remains unknown.

## Provider-contract status

The current repository has only read-side Avantio endpoint evidence. It does not contain authenticated Avantio create documentation, a sanitized create response, or evidence identifying a reliable exact external-reference field in an accommodation response. Therefore the provider contract version is `unverified`; mappings and create payload construction are intentionally unavailable. No historical or guessed payload is used.

Readiness validates the canonical structure and reports `contract_unavailable` as a blocking error. Reconciliation and creation hard-fail with `external_reference_lookup_unavailable` rather than fuzzy-match or create duplicates. Once authenticated documentation or sanitized live GET evidence identifies the exact reference field and required create fields/enums, add the verified contract and mapping before enabling those operations.

## Feature flag and variables

Required Worker bindings are `API_KEY`, `AVANTIO_API_KEY`, `AVANTIO_BASE_URL`, and `DB`. `AVANTIO_ACCOMMODATION_CREATE_ENABLED` is a string flag and is enabled only when its normalized value is exactly `true`; its default in `wrangler.jsonc` is `false`.

Even with the flag set, this release never POSTs because the contract and lookup evidence are unavailable. Provider secrets, authorization headers, and complete provider payloads must never be logged.

## Hashing and uncertain outcomes

When a verified create payload exists, its SHA-256 hash must be generated from recursively key-sorted JSON with preserved array order and no IDs/timestamps. Create flow must validate, re-run readiness, hash, exact-reference lookup, then POST once. A timeout after transmission, connection loss, or success-shaped response lacking an external ID is `uncertain`; callers reconcile before any retry.

## Safe smoke test

1. Set a test `API_KEY`; leave `AVANTIO_ACCOMMODATION_CREATE_ENABLED=false`.
2. POST a non-sensitive canonical property to readiness and confirm no Avantio mutation occurs.
3. POST to create and verify the configuration response; no provider POST should be observed.
4. POST reconcile and verify lookup is unavailable until a verified exact-reference field is implemented.
5. Only after contract verification, use a disposable property code in the provider sandbox and reconcile after any uncertain response.
