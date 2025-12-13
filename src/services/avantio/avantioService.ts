import { Env } from "../../types/configTypes";
import { AvantioBooking, AvantioResponse, AvantioAccommodation } from "../../types/avantioTypes";


export class AvantioService {

    private apiKey: string;
    private baseUrl: string;
    
    constructor(env: Env) {
        this.apiKey = env.AVANTIO_API_KEY;
        this.baseUrl = env.AVANTIO_BASE_URL;
    }
    
    private async fetchAllPages(initialUrl: string): Promise<AvantioBooking[]> {
    let allBookings: AvantioBooking[] = [];
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

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[AvantioService] Erro na requisição: ${response.status} - ${errorText}`);
        throw new Error(`Falha ao buscar dados da Avantio: ${response.statusText}`);
      }

      const bookins = (await response.json()) as AvantioResponse;

      if (bookins.data && bookins.data.length > 0) {
        allBookings = allBookings.concat(bookins.data);
      }

      if (bookins._links && bookins._links.next) {
        nextUrl = bookins._links.next;
      } else {
        nextUrl = null;
      }
    }

    console.log(`[AvantioService] Busca finalizada. Total de itens: ${allBookings.length}`);
    return allBookings;
    }

    async getCheckins(date: string): Promise<AvantioBooking[]> {

        const url = new URL(`${this.baseUrl}/bookings`);
        
        url.searchParams.append("arrivalDate_from", date);
        url.searchParams.append("arrivalDate_to", date);
        url.searchParams.append("pagination_size", "50"); 

        return this.fetchAllPages(url.toString());
    }

    async getCheckouts(date: string): Promise<AvantioBooking[]> {

        const url = new URL(`${this.baseUrl}/bookings`);

        url.searchParams.append("departureDate_from", date);
        url.searchParams.append("departureDate_to", date);
        url.searchParams.append("pagination_size", "50");

        return this.fetchAllPages(url.toString());
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
              console.error(`[AvantioService] Falha ao buscar imóvel ${accommodationId}: ${response.status}`);
              return null;
          }

          const json = await response.json() as { data: Omit<AvantioAccommodation, 'id'> };
          
            return {
              ...json.data,
              id: accommodationId 
            } as AvantioAccommodation;
        
      } catch (error) {
          console.error(`[AvantioService] Erro de rede ao buscar imóvel ${accommodationId}`, error);
          return null;
      }
  }
}