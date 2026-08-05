import { describe, expect, it } from "vitest";
import {
  AVANTIO_PROVIDER_ERROR_MAX_BODY_BYTES,
  AVANTIO_PROVIDER_ERROR_MAX_CODE_LENGTH,
  AVANTIO_PROVIDER_ERROR_MAX_ISSUES,
  AVANTIO_PROVIDER_ERROR_MAX_MESSAGE_LENGTH,
  AVANTIO_PROVIDER_ERROR_MAX_PATH_LENGTH,
  parseAvantioProviderError,
} from "../../src/integrations/avantio/accommodations";

describe("parseAvantioProviderError", () => {
  it("extracts errors with field and message", () => {
    expect(parseAvantioProviderError(JSON.stringify({ errors: [{ field: "location.address", message: "Invalid address" }] }))).toEqual([{
      code: "provider_validation_error",
      message: "Invalid address",
      canonical_path: null,
      provider_path: "location.address",
      section: "provider",
    }]);
  });

  it("extracts nested error.details", () => {
    expect(parseAvantioProviderError(JSON.stringify({ error: { details: [{ path: "distribution.bathrooms[0].type", message: "Required value" }] } }))[0]).toMatchObject({
      provider_path: "distribution.bathrooms[0].type",
      message: "Required value",
    });
  });

  it("extracts JSON:API source.pointer and detail", () => {
    expect(parseAvantioProviderError(JSON.stringify({ errors: [{ source: { pointer: "/data/attributes/name" }, detail: "Name is required" }] }))[0]).toMatchObject({
      provider_path: "/data/attributes/name",
      message: "Name is required",
    });
  });

  it("preserves a bounded top-level safe message", () => {
    expect(parseAvantioProviderError(JSON.stringify({ message: " Validation   failed\nfor the request " }))).toEqual([
      expect.objectContaining({ code: "provider_validation_error", message: "Validation failed for the request", provider_path: null }),
    ]);
  });

  it.each(["", "{malformed"])("returns no details for empty or malformed body %#", (body) => {
    expect(parseAvantioProviderError(body)).toEqual([]);
  });

  it("deduplicates equal issues", () => {
    const issue = { field: "location.address", message: "Invalid address", code: "INVALID" };
    expect(parseAvantioProviderError(JSON.stringify({ errors: [issue, issue] }))).toHaveLength(1);
  });

  it("truncates issue count to 20", () => {
    const errors = Array.from({ length: 30 }, (_, index) => ({ field: `field.${index}`, message: `Issue ${index}` }));
    expect(parseAvantioProviderError(JSON.stringify({ errors }))).toHaveLength(AVANTIO_PROVIDER_ERROR_MAX_ISSUES);
  });

  it("truncates messages, paths, and normalized provider codes", () => {
    const [issue] = parseAvantioProviderError(JSON.stringify({ errors: [{
      field: "p".repeat(400),
      message: "m".repeat(700),
      code: `VALIDATION ${"c".repeat(200)}`,
    }] }));
    expect(issue.message).toHaveLength(AVANTIO_PROVIDER_ERROR_MAX_MESSAGE_LENGTH);
    expect(issue.provider_path).toHaveLength(AVANTIO_PROVIDER_ERROR_MAX_PATH_LENGTH);
    expect(issue.code).toHaveLength(AVANTIO_PROVIDER_ERROR_MAX_CODE_LENGTH);
    expect(issue.code).toMatch(/^provider_[a-z0-9._-]+$/);
  });

  it("ignores issues beyond the maximum nesting depth", () => {
    let nested: unknown = { field: "too.deep", message: "Must not escape" };
    for (let depth = 0; depth < 10; depth += 1) nested = { details: [nested] };
    expect(parseAvantioProviderError(JSON.stringify({ errors: [nested] }))).toEqual([]);
  });

  it.each([
    JSON.stringify({ message: "<html><body>provider failure</body></html>" }),
    "<!doctype html><html><body>failure</body></html>",
  ])("does not return HTML", (body) => {
    expect(parseAvantioProviderError(body)).toEqual([]);
  });

  it("does not return secret-like paths or values", () => {
    const serialized = JSON.stringify(parseAvantioProviderError(JSON.stringify({ errors: [
      { field: "authorization.token", message: "Bearer abc.def.secret" },
      { field: "location.address", message: "api_key=super-secret-value" },
      { field: "location.city", message: "Safe city validation" },
    ] })));
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("super-secret-value");
    expect(serialized).toContain("Safe city validation");
  });

  it("does not inspect an issue placed beyond the 64 KiB body bound", () => {
    const body = `${" ".repeat(AVANTIO_PROVIDER_ERROR_MAX_BODY_BYTES)}${JSON.stringify({ errors: [{ message: "outside bound" }] })}`;
    expect(parseAvantioProviderError(body)).toEqual([]);
  });
});
