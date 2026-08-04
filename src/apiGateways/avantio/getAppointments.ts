import { AvantioAccommodation, AvantioBooking, AvantioResponse } from "../../types/avantioTypes";
import { Env } from "../../types/configTypes";
import { AvantioAccommodationCreateRequest, AvantioAccommodationCreateRequestSchema, AvantioAccommodationCreateSuccessSchema } from "../../integrations/avantio/accommodations/createContract";
import { authoritativeAccommodationId, AccommodationCandidate, accommodationToCandidate } from "../../integrations/avantio/accommodations/lookup";
import { AvantioProviderError, classifyReceivedStatus } from "../../integrations/avantio/accommodations/providerErrors";
import {
    AccommodationIndexError,
    AccommodationReferenceIndexRepository,
    DEFAULT_ACCOMMODATION_INDEX_MAX_AGE_SECONDS,
} from "../../repositories/accommodation/accommodationReferenceIndexRepository";

export type AvantioCreateResult = { externalId: string; remoteStatus: string | null; providerRequestId: string | null };
export type AvantioAccommodationPage = { records: Array<Record<string, unknown>>; nextPageUrl: string | null };

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
        const url = nextPageUrl ? new URL(nextPageUrl) : new URL(`${this.baseUrl}/accommodations`);
        url.searchParams.set("pagination_size", String(boundedPageSize));

        let response: Response;
        try {
            response = await fetch(url.toString(), {
                method: "GET",
                headers: { "X-Avantio-Auth": this.apiKey, "accept": "application/json" },
            });
        } catch {
            throw new AvantioProviderError("temporarily_unavailable", "accommodation_index_batch_failed", "A página de acomodações não pôde ser consultada.", "fetch_invoked");
        }

        const providerRequestId = response.headers.get("x-avantio-request-id") ?? response.headers.get("x-request-id") ?? response.headers.get("request-id");
        let responseText: string;
        try {
            responseText = await response.text();
        } catch {
            throw new AvantioProviderError("temporarily_unavailable", "accommodation_index_batch_failed", "A resposta da página de acomodações não pôde ser lida.", "response_received", response.status, providerRequestId);
        }
        if (!response.ok) {
            throw new AvantioProviderError("temporarily_unavailable", "accommodation_index_batch_failed", "A Avantio não conseguiu fornecer a página de acomodações.", "body_received", response.status, providerRequestId);
        }

        let payload: unknown;
        try {
            payload = JSON.parse(responseText);
        } catch {
            throw new AvantioProviderError("temporarily_unavailable", "accommodation_index_batch_failed", "A Avantio retornou uma página de acomodações inválida.", "body_received", response.status, providerRequestId);
        }
        if (!payload || typeof payload !== "object" || !Array.isArray((payload as Record<string, unknown>).data)) {
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
        if (next !== undefined && next !== null && typeof next !== "string") {
            throw new AvantioProviderError("temporarily_unavailable", "accommodation_index_batch_failed", "A paginação de acomodações é inválida.", "body_received", response.status, providerRequestId);
        }
        return { records, nextPageUrl: typeof next === "string" && next.trim() ? next : null };
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

    async createAccommodation(payload: AvantioAccommodationCreateRequest, timeoutMs = 15000): Promise<AvantioCreateResult> {
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
        let text: string;
        try {
            text = await response.text();
        } catch {
            const kind = response.ok ? "uncertain" : classifyReceivedStatus(response.status);
            throw new AvantioProviderError(kind, "provider_body_unreadable", response.ok ? "O resultado remoto da criação não pôde ser confirmado." : "A resposta da Avantio não pôde ser lida.", "response_received", response.status, providerRequestId);
        }

        if (!response.ok) {
            throw new AvantioProviderError(classifyReceivedStatus(response.status), `provider_http_${response.status}`, "A Avantio rejeitou ou não conseguiu processar a solicitação.", "body_received", response.status, providerRequestId);
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
