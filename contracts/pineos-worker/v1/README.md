# PineOS → Worker accommodation contract v1

These files define only the normalized PineOS-facing boundary. They are not Avantio payloads and must never be sent directly to Avantio.

`canonical-request.json` is accepted by readiness and reconciliation. Add `job_id` for create. The response fixtures enumerate the stable public shapes.

Current implementation status: the authoritative Worker `AvantioAccommodation` read model has no verified external-reference field and the gateway has no authoritative accommodation create-request model. Therefore readiness returns `not_ready`, reconciliation returns `temporarily_unavailable`, and create returns `create_disabled` while `AVANTIO_ACCOMMODATION_CREATE_ENABLED=false`. The `ready`, `created`, and lookup-success fixtures reserve the public contract for a future implementation after those provider facts are added to the authoritative Worker model.
