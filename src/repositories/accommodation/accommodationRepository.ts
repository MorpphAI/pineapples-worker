import { D1Database } from "@cloudflare/workers-types";
import { AvantioAccommodation } from "../../types/avantioTypes";
import { AccommodationRow } from "../../types/accommodationTypes";

export class AccommodationRepository {
    private db: D1Database;

    constructor(db: D1Database) {
        this.db = db;
    }

    async upsertMany(accommodations: AvantioAccommodation[]): Promise<number> {
        const rows = accommodations
            .map(accommodationToRow)
            .filter((row): row is AccommodationUpsertRow => !!row);

        if (rows.length === 0) return 0;

        const stmt = this.db.prepare(`
            INSERT INTO accommodations (
                accommodation_id,
                name,
                status,
                area_m2,
                addr_type,
                address,
                number,
                door,
                city_name,
                latitude,
                longitude,
                last_seen_at,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(accommodation_id) DO UPDATE SET
                name = excluded.name,
                status = excluded.status,
                area_m2 = excluded.area_m2,
                addr_type = excluded.addr_type,
                address = excluded.address,
                number = excluded.number,
                door = excluded.door,
                city_name = excluded.city_name,
                latitude = excluded.latitude,
                longitude = excluded.longitude,
                last_seen_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
        `);

        const batch = rows.map(row => stmt.bind(
            row.accommodation_id,
            row.name,
            row.status,
            row.area_m2,
            row.addr_type,
            row.address,
            row.number,
            row.door,
            row.city_name,
            row.latitude,
            row.longitude,
        ));

        await this.db.batch(batch);
        return rows.length;
    }

    async findAll(): Promise<AccommodationRow[]> {
        const { results } = await this.db
            .prepare("SELECT * FROM accommodations ORDER BY name ASC")
            .all<AccommodationRow>();

        return results || [];
    }

    async findById(id: string): Promise<AccommodationRow | null> {
        const result = await this.db
            .prepare("SELECT * FROM accommodations WHERE accommodation_id = ?")
            .bind(id)
            .first<AccommodationRow>();

        return result || null;
    }
}

type AccommodationUpsertRow = Pick<
    AccommodationRow,
    | "accommodation_id"
    | "name"
    | "status"
    | "area_m2"
    | "addr_type"
    | "address"
    | "number"
    | "door"
    | "city_name"
    | "latitude"
    | "longitude"
>;

function accommodationToRow(accommodation: AvantioAccommodation): AccommodationUpsertRow | null {
    const accommodationId = optionalString(accommodation.id);
    if (!accommodationId) return null;

    const location = accommodation.location;
    const coordinates = location?.coordinates;

    return {
        accommodation_id: accommodationId,
        name: optionalString(accommodation.name) || accommodationId,
        status: optionalString(accommodation.status),
        area_m2: optionalInteger(accommodation.area?.livingSpace?.amount),
        addr_type: optionalString(location?.addrType),
        address: optionalString(location?.address),
        number: optionalString(location?.number),
        door: optionalString(location?.door),
        city_name: optionalString(location?.cityName),
        latitude: optionalFloat(coordinates?.lat),
        longitude: optionalFloat(coordinates?.lon),
    };
}

function optionalString(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed ? trimmed : null;
}

function optionalInteger(value: unknown): number | null {
    if (value === undefined || value === null || value === "") return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
}

function optionalFloat(value: unknown): number | null {
    if (value === undefined || value === null || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
