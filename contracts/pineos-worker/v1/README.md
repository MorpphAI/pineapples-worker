# PineOS → Worker accommodation contract v1

These files define only the normalized PineOS-facing boundary. They are not raw Avantio payloads and must never be forwarded directly by PineOS.

`canonical-request.json` is accepted by readiness and reconciliation. Add `job_id` for create. The response fixtures enumerate outcomes the implementation can produce. Payload hashes are SHA-256 values over recursively canonicalized Worker-owned provider requests.

The Worker maps canonical data into the production-evidenced `POST /accommodations` contract, performs case-sensitive exact lookup against top-level `externalReference`, and requires a non-empty `response.data.id` for creation success. The repository feature flag remains false, so zero-match create requests return `create_disabled`; existing accommodations can still return `found_existing`, and reconciliation remains read-only.
