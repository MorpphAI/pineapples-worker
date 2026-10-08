import { SELF } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { probeAvantioOwnerRead } from "../../src/apiGateways/avantio/ownerReadProbe";

const env = {
  AVANTIO_API_KEY: "internal-provider-secret",
  AVANTIO_BASE_URL: "https://api.avantio.pro/pms/v2",
};

function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Avantio owner read-only probe", () => {
  it("checks one specific owner via GET and does not enumerate on success", async () => {
    const remote = vi.fn().mockResolvedValue(reply(200, {
      data: { id: 244405, name: "Exemplo", surnames: ["Silva"], email: "private@example.test", phone: "private" },
    }));
    const report = await probeAvantioOwnerRead(env, "244405", remote);
    expect(report.owner_name_available).toBe(true);
    expect(report.checks).toEqual([{
      route: "detail", status: 200, response_kind: "object",
      owner_id_matches: true, has_name_fields: true,
      record_keys: ["id", "name", "surnames"],
    }]);
    expect(remote).toHaveBeenCalledTimes(1);
    expect(remote.mock.calls[0][0]).toBe("https://api.avantio.pro/pms/v2/owners/244405");
    expect(remote.mock.calls[0][1]).toMatchObject({
      method: "GET",
      headers: { "X-Avantio-Auth": "internal-provider-secret" },
    });
    expect(JSON.stringify(report)).not.toContain("Exemplo");
    expect(JSON.stringify(report)).not.toContain("private");
  });

  it("falls back to the bounded owners collection and never confuses other owner names", async () => {
    const remote = vi.fn()
      .mockResolvedValueOnce(reply(404))
      .mockResolvedValueOnce(reply(200, { data: [{ id: 999999, name: "Outra pessoa" }] }));
    const report = await probeAvantioOwnerRead(env, "244405", remote);
    expect(report.owner_name_available).toBe(false);
    expect(report.checks).toHaveLength(2);
    expect(report.checks[0].status).toBe(404);
    expect(report.checks[1]).toMatchObject({
      route: "collection", status: 200, response_kind: "array",
      owner_id_matches: false, has_name_fields: true,
    });
    expect(remote.mock.calls[1][0]).toBe("https://api.avantio.pro/pms/v2/owners?pagination_size=1");
    expect(JSON.stringify(report)).not.toContain("Outra pessoa");
  });

  it("stops immediately on provider permission errors", async () => {
    const remote = vi.fn().mockResolvedValue(reply(403, { email: "secret", api_key: "key" }));
    const report = await probeAvantioOwnerRead(env, "244405", remote);
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0].status).toBe(403);
    expect(JSON.stringify(report)).not.toContain("secret");
  });

  it("rejects path injection and never calls the provider", async () => {
    const remote = vi.fn();
    await expect(probeAvantioOwnerRead(env, "../bookings", remote)).rejects.toThrow("invalid_owner_id");
    expect(remote).not.toHaveBeenCalled();
  });

  it("does not expose upstream errors when calls fail", async () => {
    const remote = vi.fn().mockRejectedValue(new Error("secret token in an error"));
    const report = await probeAvantioOwnerRead(env, "244405", remote);
    expect(report.checks).toHaveLength(2);
    expect(report.checks[0].response_kind).toBe("network_error");
    expect(JSON.stringify(report)).not.toContain("token");
  });

  it("is protected by x-api-key and rejects bad owner identifiers", async () => {
    const missingKey = await SELF.fetch("http://local.test/v1/avantio/owners/244405/probe");
    expect(missingKey.status).toBe(401);
    const invalid = await SELF.fetch("http://local.test/v1/avantio/owners/bad-owner/probe", {
      headers: { "x-api-key": "test-key" },
    });
    expect(invalid.status).toBe(422);
  });
});
