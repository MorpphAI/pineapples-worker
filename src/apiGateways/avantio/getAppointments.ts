import { AvantioAccommodation, AvantioBooking, AvantioResponse } from "../../types/avantioTypes";
import { Env } from "../../types/configTypes";
import { AvantioAccommodationCreateRequest, AvantioAccommodationCreateRequestSchema, AvantioAccommodationCreateSuccessSchema } from "../../integrations/avantio/accommodations/createContract";
import { authoritativeAccommodationId, AccommodationCandidate, accommodationToCandidate } from "../../integrations/avantio/accommodations/lookup";
import { AvantioProviderError, classifyReceivedStatus } from "../../integrations/avantio/accommodations/providerErrors";
import {
    AVANTIO_PROVIDER_ERROR_MAX_BODY_BYTES,
    AvantioProviderErrorParserMetadata,
    AvantioProviderIssue,
    parseAvantioProviderErrorWithMetadata,
} from "../../integrations/avantio/accommodations/providerErrorParser";
import {
    AccommodationIndexError,
    AccommodationReferenceIndexRepository,
    DEFAULT_ACCOMMODATION_INDEX_MAX_AGE_SECONDS,
} from "../../repositories/accommodation/accommodationReferenceIndexRepository";

export type AvantioCreateResult = { externalId: string; remoteStatus: string | null; providerRequestId: string | null };
export type AvantioAccommodationPage = { records: Array<Record<string, unknown>>; nextPageUrl: string | null };
export type AvantioCreateDiagnosticContext = { requestId: string; jobId: string; propertyId: string };

type BoundedProviderBody = { text: string; bytes: Uint8Array };

function safeDiagnosticId(value: string | null | undefined): string | null {
    const trimmed = value?.trim() ?? "";
    return /^[A-Za-z0-9._:-]{1,128}$/.test(trimmed) ? trimmed : null;
}

function safeContentType(value: string | null): string | null {
    const trimmed = value?.trim() ?? "";
    return /^[A-Za-z0-9!#$&^_.+\-*/;= ]{1,100}$/.test(trimmed) ? trimmed : null;
}

async function readBoundedProviderBody(response: Response): Promise<BoundedProviderBody> {
    if (!response.body) {
        const text = await response.text();
        const allBytes = new TextEncoder().encode(text);
        const bytes = allBytes.slice(0, AVANTIO_PROVIDER_ERROR_MAX_BODY_BYTES);
        return { text: new TextDecoder().decode(bytes), bytes };
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let count = 0;
    try {
        while (count < AVANTIO_PROVIDER_ERROR_MAX_BODY_BYTES) {
            const { done, value } = await reader.read();
            if (done) break;
            const remaining = AVANTIO_PROVIDER_ERROR_MAX_BODY_BYTES - count;
            const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
            chunks.push(chunk);
            count += chunk.byteLength;
            if (value.byteLength > remaining) break;
        }
        if (count >= AVANTIO_PROVIDER_ERROR_MAX_BODY_BYTES) await reader.cancel();
    } finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(count);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { text: new TextDecoder().decode(bytes), bytes };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function logCreateProviderRejected(
    context: AvantioCreateDiagnosticContext | undefined,
    status: number,
    outcome: "provider_rejected" | "temporarily_unavailable",
    providerRequestId: string | null,
    issues: AvantioProviderIssue[],
    contentType: string | null,
    bodyByteCount: number,
    bodySha256: string,
    parserMetadata: AvantioProviderErrorParserMetadata,
): void {
    const diagnostic: Record<string, unknown> = {
        event: "avantio_create_provider_rejected",
        request_id: safeDiagnosticId(context?.requestId),
        job_id: safeDiagnosticId(context?.jobId),
        property_id: safeDiagnosticId(context?.propertyId),
        provider_http_status: status,
        outcome,
        extracted_issue_count: issues.length,
        issue_codes: issues.map((issue) => issue.code),
        provider_paths: issues.flatMap((issue) => issue.provider_path ? [issue.provider_path] : []),
        response_content_type: contentType,
        response_body_byte_count: bodyByteCount,
        response_body_sha256: bodySha256,
        parsed_json: parserMetadata.parsed_json,
        top_level_shape: parserMetadata.top_level_shape,
        recognized_container_keys: parserMetadata.recognized_container_keys,
        validation_nodes_seen: parserMetadata.validation_nodes_seen,
        constraint_nodes_seen: parserMetadata.constraint_nodes_seen,
        child_nodes_seen: parserMetadata.child_nodes_seen,
        validation_map_nodes_seen: parserMetadata.validation_map_nodes_seen,
        validation_map_candidate_keys_seen: parserMetadata.validation_map_candidate_keys_seen,
        validation_map_string_leaves_seen: parserMetadata.validation_map_string_leaves_seen,
        validation_map_string_array_leaves_seen: parserMetadata.validation_map_string_array_leaves_seen,
        validation_map_rule_maps_seen: parserMetadata.validation_map_rule_maps_seen,
        validation_map_nested_maps_seen: parserMetadata.validation_map_nested_maps_seen,
        validation_map_constraint_descriptor_maps_seen: parserMetadata.validation_map_constraint_descriptor_maps_seen,
        validation_map_constraint_descriptor_leaves_seen: parserMetadata.validation_map_constraint_descriptor_leaves_seen,
        ignored_sensitive_keys_seen: parserMetadata.ignored_sensitive_keys_seen,
        ignored_unsupported_leaves_seen: parserMetadata.ignored_unsupported_leaves_seen,
        unsupported_leaf_null_count: parserMetadata.unsupported_leaf_null_count,
        unsupported_leaf_boolean_count: parserMetadata.unsupported_leaf_boolean_count,
        unsupported_leaf_number_count: parserMetadata.unsupported_leaf_number_count,
        unsupported_leaf_array_count: parserMetadata.unsupported_leaf_array_count,
        unsupported_leaf_object_count: parserMetadata.unsupported_leaf_object_count,
        validation_map_invalid_path_keys_seen: parserMetadata.validation_map_invalid_path_keys_seen,
        safe_candidate_provider_paths: parserMetadata.safe_candidate_provider_paths,
        details_object_count: parserMetadata.details_object_count,
        details_array_count: parserMetadata.details_array_count,
        details_string_count: parserMetadata.details_string_count,
    };
    const safeProviderRequestId = safeDiagnosticId(providerRequestId);
    if (safeProviderRequestId) diagnostic.provider_request_id = safeProviderRequestId;
    console.error(JSON.stringify(diagnostic));
}

function sanitizedDiagnosticValue(value: string | null): string | null {
    if (!value) return null;
    const sanitized = value.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 128);
    return sanitized || null;
}

function logAccommodationIndexDiagnostic(stage: string, code: string, status: number | null = null, providerRequestId: string | null = null, level: "error" | "info" = "error"): void {
    const fields = [`stage=${stage}`, `code=${code}`];
    if (status !== null) fields.push(`status=${status}`);
    const safeRequestId = sanitizedDiagnosticValue(providerRequestId);
    if (safeRequestId) fields.push(`provider_request_id=${safeRequestId}`);
    console[level](`[AvantioAccommodationIndex] ${fields.join(" ")}`);
}

function cursorError(reason: string, status: number | null = null, providerRequestId: string | null = null): AvantioProviderError {
    logAccommodationIndexDiagnostic(reason, "accommodation_index_cursor_invalid", status, providerRequestId);
    return new AvantioProviderError("temporarily_unavailable", "accommodation_index_cursor_invalid", "Invalid accommodation continuation cursor.", status === null ? "request_built" : "body_received", status, providerRequestId);
}

function extractAccommodationCursor(value: unknown, status: number | null = null, providerRequestId: string | null = null): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value === "string") return value.trim() ? value : null;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw cursorError("cursor_non_string", status, providerRequestId);
    }

    const link = value as Record<string, unknown>;
    const candidates = [link.href, link.url, link.uri]
        .filter((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);
    if (candidates.length !== 1) {
        throw cursorError("cursor_non_string", status, providerRequestId);
    }
    return candidates[0];
}

function resolveAccommodationCursor(
    cursor: string,
    trustedListUrl: URL,
    configuredBase: URL,
    status: number | null = null,
    providerRequestId: string | null = null,
): string {
    const configuredBasePath = configuredBase.pathname.replace(/\/+$/, "");
    const explicitScheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(cursor)?.[1]?.toLowerCase() ?? null;
    if (explicitScheme && explicitScheme !== "http" && explicitScheme !== "https") {
        throw cursorError("cursor_protocol_invalid", status, providerRequestId);
    }

    let candidate: URL;
    try {
        if (/^\/accommodations\/?(?:[?#]|$)/.test(cursor)) {
            logAccommodationIndexDiagnostic("cursor_base_path_omitted_normalized", "cursor_normalized", status, providerRequestId, "info");
            candidate = new URL(`${configuredBasePath}${cursor}`, configuredBase.origin);
        } else {
            candidate = new URL(cursor, trustedListUrl);
        }
    } catch {
        throw cursorError("cursor_parse_failed", status, providerRequestId);
    }

    if (candidate.username || candidate.password) throw cursorError("cursor_credentials_invalid", status, providerRequestId);

    const accommodationPath = `${configuredBasePath}/accommodations` || "/accommodations";
    const rootAccommodationPath = "/accommodations";
    const allowedPath = candidate.pathname === accommodationPath
        || candidate.pathname === `${accommodationPath}/`
        || candidate.pathname === rootAccommodationPath
        || candidate.pathname === `${rootAccommodationPath}/`;
    if (!allowedPath) {
        throw cursorError("cursor_path_invalid", status, providerRequestId);
    }

    const queryStart = cursor.indexOf("?");
    const fragmentStart = cursor.indexOf("#");
    const hasQuery = queryStart >= 0 && (fragmentStart < 0 || queryStart < fragmentStart);
    const continuationQuery = !hasQuery
        ? ""
        : cursor.slice(queryStart, fragmentStart >= 0 ? fragmentStart : undefined);
    return `${trustedListUrl.origin}${trustedListUrl.pathname}${continuationQuery}`;
}

export class AvantioApiGateway {
    private apiKey: string;
    private baseUrl: string;
    private referenceIndex: AccommodationReferenceIndexRepository;
    private indexMaxAgeSeconds: number;

    constructor(env: Env) {
        this.apiKey = env.AVANTIO_API_KEY;
        this.baseUrl = env.AVANTIO_BASE_URL;
        this.referenceIndex = new AccommodationReferenceIndexRepository(env.DB);
        const configuredMaxAge = Number(env.AVANTIO_ACCOMMODATION_INDEX_MAX_AGE_SECONDS);
        this.indexMaxAgeSeconds = Number.isFinite(configuredMaxAge) && configuredMaxAge > 0
            ? Math.floor(configuredMaxAge)
            : DEFAULT_ACCOMMODATION_INDEX_MAX_AGE_SECONDS;
    }

    private async fetchAllPages<T>(initialUrl: string): Promise<T[]> {
        let allItems: T[] = [];
        let nextUrl: string | null = initialUrl;

        console.log(`[AvantioService] Iniciando busca: ${initialUrl}`);

        while (nextUrl) {
            const response = await fetch(nextUrl, {
                method: "GET",
                headers: {
                    "X-Avantio-Auth": this.apiKey,
                    "accept": "application/json",
                },
            });

            const providerRequestId = response.headers.get("x-avantio-request-id") ?? response.headers.get("x-request-id") ?? response.headers.get("request-id");
            const responseText = await response.text();

            if (!response.ok) {
                console.error(`[AvantioService] Erro na requisicao: ${response.status}`);
                throw new AvantioProviderError(classifyReceivedStatus(response.status), `provider_http_${response.status}`, "A Avantio rejeitou ou não conseguiu processar a consulta.", "body_received", response.status, providerRequestId);
            }

            let payload: AvantioResponse<T>;
            try { payload = JSON.parse(responseText) as AvantioResponse<T>; }
            catch { throw new AvantioProviderError("invalid_provider_response", "malformed_provider_json", "A Avantio retornou JSON inválido.", "body_received", response.status, providerRequestId); }

            if (payload.data && payload.data.length > 0) {
                allItems = allItems.concat(payload.data);
            }

            nextUrl = payload._links?.next || null;
        }

        console.log(`[AvantioService] Busca finalizada. Total de itens: ${allItems.length}`);
        return allItems;
    }

    async getCheckins(date: string): Promise<AvantioBooking[]> {
        const url = new URL(`${this.baseUrl}/bookings`);
        url.searchParams.append("arrivalDate_from", date);
        url.searchParams.append("arrivalDate_to", date);
        url.searchParams.append("pagination_size", "50");

        return this.fetchAllPages<AvantioBooking>(url.toString());
    }

    async getCheckouts(date: string): Promise<AvantioBooking[]> {
        const url = new URL(`${this.baseUrl}/bookings`);
        url.searchParams.append("departureDate_from", date);
        url.searchParams.append("departureDate_to", date);
        url.searchParams.append("pagination_size", "50");

        return this.fetchAllPages<AvantioBooking>(url.toString());
    }

    async getAccommodations(): Promise<AvantioAccommodation[]> {
        const url = new URL(`${this.baseUrl}/accommodations`);
        url.searchParams.append("pagination_size", "50");

        const rawAccommodations = await this.fetchAllPages<Record<string, any>>(url.toString());
        const accommodations: AvantioAccommodation[] = [];

        for (const raw of rawAccommodations) {
            const id = raw?.id ?? raw?.accommodationId ?? raw?.accommodation_id ?? raw?.galleryId;
            if (!id) {
                console.warn("[AvantioService] Imovel ignorado na sincronizacao: payload sem id.");
                continue;
            }

            accommodations.push({
                ...raw,
                id: String(id),
            } as AvantioAccommodation);
        }

        return accommodations;
    }

    async getAccommodationsPage(nextPageUrl: string | null, pageSize = 10): Promise<AvantioAccommodationPage> {
        const boundedPageSize = Math.max(1, Math.min(10, Math.floor(pageSize)));
        let listUrl: URL;
        try {
            listUrl = new URL(`${this.baseUrl.replace(/\/+$/, "")}/accommodations`);
        } catch {
            logAccommodationIndexDiagnostic("cursor_resolution", "accommodation_index_cursor_invalid");
            throw new AvantioProviderError("temporarily_unavailable", "accommodation_index_cursor_invalid", "Invalid accommodation continuation cursor.", "request_built");
        }

        const configuredBase = new URL(this.baseUrl);

        let requestUrl: string;
        if (nextPageUrl) {
            requestUrl = resolveAccommodationCursor(nextPageUrl, listUrl, configuredBase);
        } else {
            const initialUrl = new URL(listUrl.toString());
            initialUrl.searchParams.set("pagination_size", String(boundedPageSize));
            requestUrl = initialUrl.toString();
        }

        let response: Response;
        try {
            response = await fetch(requestUrl, {
                method: "GET",
                headers: { "X-Avantio-Auth": this.apiKey, "accept": "application/json" },
            });
        } catch {
            logAccommodationIndexDiagnostic("provider_fetch", "accommodation_index_batch_failed");
            throw new AvantioProviderError("temporarily_unavailable", "accommodation_index_batch_failed", "A página de acomodações não pôde ser consultada.", "fetch_invoked");
        }

        const providerRequestId = response.headers.get("x-avantio-request-id") ?? response.headers.get("x-request-id") ?? response.headers.get("request-id");
        let responseText: string;
        try {
            responseText = await response.text();
        } catch {
            logAccommodationIndexDiagnostic("provider_response_read", "accommodation_index_batch_failed", response.status, providerRequestId);
            throw new AvantioProviderError("temporarily_unavailable", "accommodation_index_batch_failed", "A resposta da página de acomodações não pôde ser lida.", "response_received", response.status, providerRequestId);
        }
        if (!response.ok) {
            logAccommodationIndexDiagnostic("provider_http", "accommodation_index_batch_failed", response.status, providerRequestId);
            throw new AvantioProviderError("temporarily_unavailable", "accommodation_index_batch_failed", "A Avantio não conseguiu fornecer a página de acomodações.", "body_received", response.status, providerRequestId);
        }

        let payload: unknown;
        try {
            payload = JSON.parse(responseText);
        } catch {
            logAccommodationIndexDiagnostic("provider_response_parse", "accommodation_index_batch_failed", response.status, providerRequestId);
            throw new AvantioProviderError("temporarily_unavailable", "accommodation_index_batch_failed", "A Avantio retornou uma página de acomodações inválida.", "body_received", response.status, providerRequestId);
        }
        if (!payload || typeof payload !== "object" || !Array.isArray((payload as Record<string, unknown>).data)) {
            logAccommodationIndexDiagnostic("provider_response_parse", "accommodation_index_batch_failed", response.status, providerRequestId);
            throw new AvantioProviderError("temporarily_unavailable", "accommodation_index_batch_failed", "A página de acomodações não contém dados válidos.", "body_received", response.status, providerRequestId);
        }
        const records: Array<Record<string, unknown>> = [];
        for (const item of (payload as { data: unknown[] }).data) {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                throw new AvantioProviderError("temporarily_unavailable", "accommodation_index_record_invalid", "A página contém um registro de acomodação inválido.", "body_received", response.status, providerRequestId);
            }
            records.push(item as Record<string, unknown>);
        }
        if (records.length > boundedPageSize) {
            throw new AvantioProviderError("temporarily_unavailable", "provider_subrequest_budget_exhausted", "A página excedeu o limite interno de registros.", "body_received", response.status, providerRequestId);
        }
        const next = (payload as { _links?: { next?: unknown } })._links?.next;
        const nextCursor = extractAccommodationCursor(next, response.status, providerRequestId);
        let resolvedNextPageUrl: string | null = null;
        if (nextCursor) {
            resolvedNextPageUrl = resolveAccommodationCursor(nextCursor, listUrl, configuredBase, response.status, providerRequestId);
        }
        return { records, nextPageUrl: resolvedNextPageUrl };
    }

    async getAccommodation(accommodationId: string): Promise<AvantioAccommodation | null> {
        const url = `${this.baseUrl}/accommodations/${accommodationId}`;

        try {
            const response = await fetch(url, {
                method: "GET",
                headers: {
                    "X-Avantio-Auth": this.apiKey,
                    "accept": "application/json",
                },
            });

            if (!response.ok) {
                console.error(`[AvantioService] Falha ao buscar imovel ${accommodationId}: ${response.status}`);
                return null;
            }

            const json = await response.json() as { data: Omit<AvantioAccommodation, "id"> };

            return {
                ...json.data,
                id: accommodationId,
            } as AvantioAccommodation;
        } catch (error) {
            console.error(`[AvantioService] Erro de rede ao buscar imovel ${accommodationId}`, error);
            return null;
        }
    }

    async getAccommodationStrict(accommodationId: string): Promise<Record<string, unknown>> {
        const url = `${this.baseUrl}/accommodations/${encodeURIComponent(accommodationId)}`;
        let response: Response;
        try {
            response = await fetch(url, {
                method: "GET",
                headers: { "X-Avantio-Auth": this.apiKey, "accept": "application/json" },
            });
        } catch {
            throw new AvantioProviderError("temporarily_unavailable", "provider_detail_network_failure", "A consulta do detalhe da acomodação falhou temporariamente.", "fetch_invoked");
        }

        const providerRequestId = response.headers.get("x-avantio-request-id") ?? response.headers.get("x-request-id") ?? response.headers.get("request-id");
        let responseText: string;
        try {
            responseText = await response.text();
        } catch {
            const kind = response.ok || response.status === 404 ? "temporarily_unavailable" : classifyReceivedStatus(response.status);
            throw new AvantioProviderError(kind, response.ok ? "provider_detail_body_unreadable" : `provider_http_${response.status}`, "A resposta do detalhe da acomodação não pôde ser lida.", "response_received", response.status, providerRequestId);
        }
        if (!response.ok) {
            const kind = response.status === 404 ? "temporarily_unavailable" : classifyReceivedStatus(response.status);
            throw new AvantioProviderError(kind, `provider_http_${response.status}`, "A Avantio rejeitou ou não conseguiu processar a consulta do detalhe.", "body_received", response.status, providerRequestId);
        }

        let payload: unknown;
        try {
            payload = JSON.parse(responseText);
        } catch {
            throw new AvantioProviderError("temporarily_unavailable", "malformed_provider_json", "A Avantio retornou JSON inválido no detalhe da acomodação.", "body_received", response.status, providerRequestId);
        }
        const data = payload && typeof payload === "object" ? (payload as Record<string, unknown>).data : null;
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            throw new AvantioProviderError("temporarily_unavailable", "missing_accommodation_detail_data", "A resposta do detalhe da acomodação não contém dados válidos.", "body_received", response.status, providerRequestId);
        }

        return data as Record<string, unknown>;
    }

    async findAccommodationsByExternalReference(reference: string): Promise<AccommodationCandidate[]> {
        let indexedMatches: AccommodationCandidate[];
        try {
            indexedMatches = await this.referenceIndex.findFreshExactMatches(reference, this.indexMaxAgeSeconds);
        } catch (error) {
            const code = error instanceof AccommodationIndexError ? error.code : "accommodation_index_refresh_required";
            throw new AvantioProviderError("temporarily_unavailable", code, "O índice exato de acomodações precisa ser atualizado.", "not_started");
        }

        const verified: AccommodationCandidate[] = [];
        for (const indexed of indexedMatches) {
            try {
                const live = await this.getAccommodationStrict(indexed.external_id);
                const liveId = authoritativeAccommodationId(live);
                if (liveId !== indexed.external_id || live.externalReference !== reference) {
                    throw new Error("indexed_match_changed");
                }
                const candidate = accommodationToCandidate({ ...live, id: liveId });
                if (!candidate) throw new Error("indexed_match_invalid");
                verified.push(candidate);
            } catch {
                await this.referenceIndex.markRefreshRequired();
                throw new AvantioProviderError("temporarily_unavailable", "accommodation_index_refresh_required", "Uma correspondência do índice não pôde ser confirmada ao vivo.", "fetch_invoked");
            }
        }
        return verified;
    }

    async upsertCreatedAccommodationInActiveIndex(externalId: string, externalReference: string, remoteStatus: string | null): Promise<void> {
        await this.referenceIndex.upsertIntoActiveGeneration({
            accommodation_id: externalId,
            external_reference: externalReference,
            name: externalReference,
            remote_status: remoteStatus,
            inspected_at: new Date().toISOString(),
        });
    }

    async createAccommodation(payload: AvantioAccommodationCreateRequest, diagnosticContext?: AvantioCreateDiagnosticContext, timeoutMs = 15000): Promise<AvantioCreateResult> {
        const validated = AvantioAccommodationCreateRequestSchema.safeParse(payload);
        if (!validated.success) throw new AvantioProviderError("provider_rejected", "invalid_provider_payload", "Payload de criação inválido.", "not_started");

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let response: Response;
        try {
            response = await fetch(`${this.baseUrl}/accommodations`, {
                method: "POST",
                headers: { "X-Avantio-Auth": this.apiKey, "accept": "application/json", "content-type": "application/json" },
                body: JSON.stringify(validated.data),
                signal: controller.signal,
            });
        } catch (error) {
            const code = error instanceof DOMException && error.name === "AbortError" ? "provider_timeout_unknown" : "provider_network_outcome_unknown";
            throw new AvantioProviderError("uncertain", code, "O resultado remoto da criação não pôde ser determinado.", "fetch_invoked");
        } finally {
            clearTimeout(timeout);
        }

        const providerRequestId = response.headers.get("x-avantio-request-id") ?? response.headers.get("x-request-id") ?? response.headers.get("request-id");
        if (!response.ok) {
            const kind = classifyReceivedStatus(response.status);
            const outcome = kind === "temporarily_unavailable" ? "temporarily_unavailable" : "provider_rejected";
            const contentType = safeContentType(response.headers.get("content-type"));
            let boundedBody: BoundedProviderBody;
            try {
                boundedBody = await readBoundedProviderBody(response);
            } catch {
                const bodySha256 = await sha256Hex(new Uint8Array());
                const parserMetadata = parseAvantioProviderErrorWithMetadata("").metadata;
                logCreateProviderRejected(diagnosticContext, response.status, outcome, providerRequestId, [], contentType, 0, bodySha256, parserMetadata);
                throw new AvantioProviderError(
                    kind,
                    "provider_body_unreadable",
                    "A resposta da Avantio não pôde ser lida.",
                    "response_received",
                    response.status,
                    providerRequestId,
                    [],
                    { contentType, bodyByteCount: 0, bodySha256, extractedIssueCount: 0 },
                );
            }
            const parsedError = parseAvantioProviderErrorWithMetadata(boundedBody.text);
            const issues = parsedError.issues;
            const bodySha256 = await sha256Hex(boundedBody.bytes);
            const metadata = { contentType, bodyByteCount: boundedBody.bytes.byteLength, bodySha256, extractedIssueCount: issues.length };
            logCreateProviderRejected(diagnosticContext, response.status, outcome, providerRequestId, issues, contentType, metadata.bodyByteCount, bodySha256, parsedError.metadata);
            throw new AvantioProviderError(
                kind,
                `provider_http_${response.status}`,
                "A Avantio rejeitou ou não conseguiu processar a solicitação.",
                "body_received",
                response.status,
                providerRequestId,
                issues,
                metadata,
            );
        }

        let text: string;
        try {
            text = await response.text();
        } catch {
            throw new AvantioProviderError("uncertain", "provider_body_unreadable", "O resultado remoto da criação não pôde ser confirmado.", "response_received", response.status, providerRequestId);
        }

        let json: unknown = null;
        if (text.trim()) {
            try { json = JSON.parse(text); } catch {
                throw new AvantioProviderError("uncertain", "malformed_provider_json", "A Avantio pode ter criado a acomodação, mas retornou JSON inválido.", "body_received", response.status, providerRequestId);
            }
        }

        const parsed = AvantioAccommodationCreateSuccessSchema.safeParse(json);
        const externalId = parsed.success ? String(parsed.data.data.id).trim() : "";
        if (!externalId) throw new AvantioProviderError("uncertain", "missing_external_id", "A Avantio pode ter criado a acomodação, mas a resposta de sucesso não contém um ID utilizável.", "body_received", response.status, providerRequestId);
        return { externalId, remoteStatus: parsed.success && typeof parsed.data.data.status === "string" ? parsed.data.data.status : null, providerRequestId };
    }
}
