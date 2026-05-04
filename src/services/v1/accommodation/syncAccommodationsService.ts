import { AvantioApiGateway } from "../../../apiGateways/avantio/getAppointments";
import { AccommodationRepository } from "../../../repositories/accommodation/accommodationRepository";
import { Env } from "../../../types/configTypes";

export class SyncAccommodationsService {
    private avantioApiGateway: AvantioApiGateway;
    private accommodationRepo: AccommodationRepository;

    constructor(env: Env) {
        this.avantioApiGateway = new AvantioApiGateway(env);
        this.accommodationRepo = new AccommodationRepository(env.DB);
    }

    async sync(): Promise<number> {
        const accommodations = await this.avantioApiGateway.getAccommodations();
        return this.accommodationRepo.upsertMany(accommodations);
    }
}
