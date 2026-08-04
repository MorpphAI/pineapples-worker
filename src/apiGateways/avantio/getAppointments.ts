import { AvantioAccommodation, AvantioBooking, AvantioResponse } from "../../types/avantioTypes";
import { Env } from "../../types/configTypes";
import { AvantioAccommodationCreateRequest, AvantioAccommodationCreateRequestSchema, AvantioAccommodationCreateSuccessSchema } from "../../integrations/avantio/accommodations/createContract";
import { exactExternalReferenceMatches, AccommodationCandidate } from "../../integrations/avantio/accommodations/lookup";
import { AvantioProviderError, classifyReceivedStatus } from "../../integrations/avantio/accommodations/providerErrors";

export type AvantioCreateResult = { externalId: string; remoteStatus: string | null; providerRequestId: string | null };

export class AvantioApiGateway {
    private apiKey: string;
    private baseUrl: string;

    constructor(env: Env) {
        this.apiKey = env.AVANTIO_API_KEY;
        this.baseUrl = env.AVANTIO_BASE_URL;
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

    async findAccommodationsByExternalReference(reference: string): Promise<AccommodationCandidate[]> {
        const accommodations = await this.getAccommodations();
        return exactExternalReferenceMatches(accommodations, reference);
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
            throw new AvantioProviderError("invalid_provider_response", "provider_body_unreadable", "A resposta da Avantio não pôde ser lida.", "response_received", response.status, providerRequestId);
        }

        let json: unknown = null;
        if (text.trim()) {
            try { json = JSON.parse(text); } catch {
                throw new AvantioProviderError("invalid_provider_response", "malformed_provider_json", "A Avantio retornou JSON inválido.", "body_received", response.status, providerRequestId);
            }
        }
        if (!response.ok) {
            throw new AvantioProviderError(classifyReceivedStatus(response.status), `provider_http_${response.status}`, "A Avantio rejeitou ou não conseguiu processar a solicitação.", "body_received", response.status, providerRequestId);
        }

        const parsed = AvantioAccommodationCreateSuccessSchema.safeParse(json);
        const externalId = parsed.success ? String(parsed.data.data.id).trim() : "";
        if (!externalId) throw new AvantioProviderError("invalid_provider_response", "missing_external_id", "A resposta de sucesso não contém um ID de acomodação válido.", "body_received", response.status, providerRequestId);
        return { externalId, remoteStatus: parsed.success && typeof parsed.data.data.status === "string" ? parsed.data.data.status : null, providerRequestId };
    }
}
