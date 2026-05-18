import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { CreateCleaners } from "../../src/controllers/v1/cleaner/createCleaners/createCleaner";
import { UpdateCleaner } from "../../src/controllers/v1/cleaner/updateCleaner/updateCleaner";
import { CleanerRepository } from "../../src/repositories/cleaner/cleanerRepository";
import worker from "../../src/index";

const createSchema =
    new CreateCleaners().schema.request.body.content["application/json"].schema;
const updateSchema =
    new UpdateCleaner().schema.request.body.content["application/json"].schema;

async function clearCleaners() {
    await env.DB.prepare("DELETE FROM cleaners").run();
}

describe("cleaner create/update contract", () => {
    beforeEach(async () => {
        await clearCleaners();
    });

    it("accepts the preferred boolean create payload", () => {
        const result = createSchema.safeParse({
            cleaners: [{
                name: "Priscila",
                zones: "ZONA1",
                shift_start: "08:00",
                shift_end: "17:00",
                fixed_accommodations: "APT 101",
                is_fixed: true,
                is_active: true,
            }],
        });

        expect(result.success).toBe(true);
    });

    it("accepts PineOS numeric create payloads", () => {
        const result = createSchema.safeParse({
            cleaners: [{
                name: "Priscila",
                zones: "ZONA1",
                shift_start: "08:00",
                shift_end: "17:00",
                fixed_accommodations: "APT 101",
                is_fixed: 1,
                is_active: 1,
            }],
        });

        expect(result.success).toBe(true);
    });

    it("accepts numeric update payloads and preserves nullable fixed accommodations", () => {
        expect(updateSchema.safeParse({
            is_fixed: 1,
            is_active: 0,
            fixed_accommodations: null,
        }).success).toBe(true);
    });

    it("persists create fields and allows clearing fixed accommodations", async () => {
        const repo = new CleanerRepository(env.DB);

        await repo.CreateCleaners([{
            name: "PRISCILA",
            zones: "ZONA1",
            shift_start: "08:00",
            shift_end: "17:00",
            phone: "555-0101",
            fixed_accommodations: "APT 101",
            is_fixed: true,
            is_active: false,
        }]);

        const created = await env.DB.prepare(
            "SELECT name, zones, shift_start, shift_end, phone, fixed_accommodations, is_fixed, is_active FROM cleaners"
        ).first<any>();

        expect(created).toEqual({
            name: "PRISCILA",
            zones: "ZONA1",
            shift_start: "08:00",
            shift_end: "17:00",
            phone: "555-0101",
            fixed_accommodations: "APT 101",
            is_fixed: 1,
            is_active: 0,
        });

        const row = await env.DB.prepare("SELECT id FROM cleaners").first<{ id: number }>();
        await repo.updateCleaner(row!.id, { fixed_accommodations: null });

        const updated = await env.DB.prepare(
            "SELECT fixed_accommodations FROM cleaners WHERE id = ?"
        ).bind(row!.id).first<{ fixed_accommodations: string | null }>();

        expect(updated?.fixed_accommodations).toBeNull();
    });

    it("accepts numeric create and patch payloads through the Worker routes", async () => {
        const routeEnv = { ...env, API_KEY: "test-key" } as any;
        const createResponse = await worker.fetch(new Request("http://local.test/v1/cleaner", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": "test-key",
            },
            body: JSON.stringify({
                cleaners: [{
                    name: "Priscila",
                    zones: "ZONA1",
                    shift_start: "08:00",
                    shift_end: "17:00",
                    phone: "555-0101",
                    fixed_accommodations: "APT 101",
                    is_fixed: 1,
                    is_active: 1,
                }],
            }),
        }), routeEnv);

        expect(createResponse.status).toBe(201);

        const created = await env.DB.prepare(
            "SELECT id, phone, fixed_accommodations, is_fixed, is_active FROM cleaners"
        ).first<any>();
        expect(created).toEqual(expect.objectContaining({
            phone: "555-0101",
            fixed_accommodations: "APT 101",
            is_fixed: 1,
            is_active: 1,
        }));

        const patchResponse = await worker.fetch(new Request(`http://local.test/v1/cleaner/${created.id}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": "test-key",
            },
            body: JSON.stringify({
                fixed_accommodations: null,
                is_fixed: 0,
                is_active: 0,
            }),
        }), routeEnv);

        expect(patchResponse.status).toBe(200);

        const updated = await env.DB.prepare(
            "SELECT fixed_accommodations, is_fixed, is_active FROM cleaners WHERE id = ?"
        ).bind(created.id).first<any>();

        expect(updated).toEqual({
            fixed_accommodations: null,
            is_fixed: 0,
            is_active: 0,
        });
    });
});
