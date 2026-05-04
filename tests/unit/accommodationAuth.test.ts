import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("accommodation route auth", () => {
    it("rejects accommodation requests without the Worker API key", async () => {
        const response = await SELF.fetch("http://local.test/v1/accommodations");
        const body = await response.json<{ success: boolean; error: string }>();

        expect(response.status).toBe(401);
        expect(body).toEqual({ success: false, error: "Unauthorized" });
    });
});
