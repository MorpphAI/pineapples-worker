import { describe, expect, it } from "vitest";
import {
  AVANTIO_PROVIDER_ERROR_MAX_BODY_BYTES,
  AVANTIO_PROVIDER_ERROR_MAX_CODE_LENGTH,
  AVANTIO_PROVIDER_ERROR_MAX_ISSUES,
  AVANTIO_PROVIDER_ERROR_MAX_MESSAGE_LENGTH,
  AVANTIO_PROVIDER_ERROR_MAX_PATH_LENGTH,
  parseAvantioProviderError,
  parseAvantioProviderErrorWithMetadata,
} from "../../src/integrations/avantio/accommodations";
import {
  providerFieldMapArrayError,
  providerFieldMapListError,
  providerFieldRuleMapError,
  providerNestedFieldMapError,
  providerValidationTreeError,
} from "../fixtures/avantioAccommodationCreate";

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

  it("extracts a simple class-validator constraints object", () => {
    expect(parseAvantioProviderError(JSON.stringify({ details: { property: "type", constraints: { isEnum: "Invalid type" } } }))).toEqual([{
      code: "provider_isenum",
      message: "Invalid type",
      canonical_path: null,
      provider_path: "type",
      section: "provider",
    }]);
  });

  it("builds dotted paths and numeric indexes through nested children", () => {
    const issues = parseAvantioProviderError(JSON.stringify(providerValidationTreeError));
    expect(issues).toEqual([
      expect.objectContaining({ code: "provider_validation_error", message: providerValidationTreeError.message, provider_path: null }),
      expect.objectContaining({ code: "provider_isdefined", message: "type should not be null", provider_path: "distribution.bathrooms[0].type" }),
      expect.objectContaining({ code: "provider_isenum", message: "type must be one of the allowed values", provider_path: "distribution.bathrooms[0].type" }),
    ]);
  });

  it("supports errors with nested children and multiple constraints", () => {
    const issues = parseAvantioProviderError(JSON.stringify({ errors: [{
      property: "capacity",
      children: [{ property: "maxAdults", constraints: { min: "maxAdults must not be less than 1", isDefined: "maxAdults is required" } }],
    }] }));
    expect(issues).toEqual([
      expect.objectContaining({ code: "provider_min", provider_path: "capacity.maxAdults" }),
      expect.objectContaining({ code: "provider_isdefined", provider_path: "capacity.maxAdults" }),
    ]);
  });

  it("prefers an explicit provider path over a synthesized property path", () => {
    expect(parseAvantioProviderError(JSON.stringify({ details: [{
      property: "conflictingProperty",
      field: "distribution.explicitType",
      constraints: { isEnum: "Invalid type" },
    }] }))[0].provider_path).toBe("distribution.explicitType");
  });

  it("accepts nested arrays and ignores empty children and non-string constraints", () => {
    const issues = parseAvantioProviderError(JSON.stringify({ details: [[
      { property: "empty", children: [] },
      { property: "capacity", children: [[{ property: "maxAdults", constraints: { min: 1, max: null, valid: "Invalid capacity" } }]] },
    ]] }));
    expect(issues).toEqual([expect.objectContaining({ code: "provider_valid", message: "Invalid capacity", provider_path: "capacity.maxAdults" })]);
  });

  it("never traverses or exposes target and value payloads", () => {
    const escaped = JSON.stringify(parseAvantioProviderError(JSON.stringify({ details: [{
      property: "type",
      constraints: { isDefined: "type is required" },
      target: { details: [{ property: "authorization", constraints: { leaked: "target-secret=never" } }] },
      value: { children: [{ property: "apiKey", constraints: { leaked: "value-secret=never" } }] },
    }] })));
    expect(escaped).toContain("type is required");
    expect(escaped).not.toContain("target-secret");
    expect(escaped).not.toContain("value-secret");
    expect(escaped).not.toContain("authorization");
    expect(escaped).not.toContain("apiKey");
  });

  it("still enforces depth for validation children", () => {
    let nested: unknown = { property: "leaf", constraints: { isDefined: "Too deep" } };
    for (let depth = 0; depth < 10; depth += 1) nested = { property: `level${depth}`, children: [nested] };
    expect(parseAvantioProviderError(JSON.stringify({ details: [nested] }))).toEqual([]);
  });

  it("still limits class-validator constraints to 20 issues", () => {
    const constraints = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`rule${index}`, `Message ${index}`]));
    expect(parseAvantioProviderError(JSON.stringify({ details: { property: "type", constraints } }))).toHaveLength(AVANTIO_PROVIDER_ERROR_MAX_ISSUES);
  });

  it("applies message, path, and code bounds to constraint issues", () => {
    const [issue] = parseAvantioProviderError(JSON.stringify({ details: {
      property: "p".repeat(400),
      constraints: { [`rule${"c".repeat(200)}`]: "m".repeat(700) },
    } }));
    expect(issue.provider_path).toHaveLength(AVANTIO_PROVIDER_ERROR_MAX_PATH_LENGTH);
    expect(issue.message).toHaveLength(AVANTIO_PROVIDER_ERROR_MAX_MESSAGE_LENGTH);
    expect(issue.code).toHaveLength(AVANTIO_PROVIDER_ERROR_MAX_CODE_LENGTH);
  });

  it("deduplicates identical constraint issues", () => {
    const node = { property: "type", constraints: { isEnum: "Invalid type" } };
    expect(parseAvantioProviderError(JSON.stringify({ details: [node, node] }))).toHaveLength(1);
  });

  it("reports only allowlisted structural metadata", () => {
    const result = parseAvantioProviderErrorWithMetadata(JSON.stringify({
      ...providerValidationTreeError,
      arbitraryProviderKey: { secretPayload: "never-report" },
    }));
    expect(result.metadata).toEqual({
      parsed_json: true,
      top_level_shape: "object",
      recognized_container_keys: ["details", "children", "constraints", "message"],
      validation_nodes_seen: 4,
      constraint_nodes_seen: 1,
      child_nodes_seen: 3,
      validation_map_nodes_seen: 0,
      validation_map_candidate_keys_seen: 0,
      validation_map_string_leaves_seen: 0,
      validation_map_string_array_leaves_seen: 0,
      validation_map_rule_maps_seen: 0,
      validation_map_nested_maps_seen: 0,
      ignored_sensitive_keys_seen: 0,
      ignored_unsupported_leaves_seen: 0,
      details_object_count: 0,
      details_array_count: 1,
      details_string_count: 0,
      extracted_issue_count: 3,
    });
    expect(JSON.stringify(result.metadata)).not.toContain("arbitraryProviderKey");
    expect(JSON.stringify(result.metadata)).not.toContain("secretPayload");
  });

  it("parses direct field strings and JSON-pointer-style field keys", () => {
    const issues = parseAvantioProviderError(JSON.stringify({ details: {
      "location.address": "Address is required",
      "/distribution/bathrooms/0/type": "Type is required",
    } }));
    expect(issues).toEqual([
      expect.objectContaining({ code: "provider_validation_error", provider_path: "location.address", message: "Address is required" }),
      expect.objectContaining({ code: "provider_validation_error", provider_path: "distribution.bathrooms[0].type", message: "Type is required" }),
    ]);
  });

  it("returns one issue per safe string in a field message array", () => {
    const issues = parseAvantioProviderError(JSON.stringify({ details: {
      "distribution.bathrooms[0].type": ["type is required", "type is invalid"],
    } }));
    expect(issues.map((issue) => issue.message)).toEqual(["type is required", "type is invalid"]);
    expect(issues.every((issue) => issue.provider_path === "distribution.bathrooms[0].type")).toBe(true);
  });

  it("parses the production field-to-string-array fixture with its summary", () => {
    const result = parseAvantioProviderErrorWithMetadata(JSON.stringify(providerFieldMapArrayError));
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "provider_validation_error", message: providerFieldMapArrayError.message, provider_path: null }),
      expect.objectContaining({ code: "provider_validation_error", message: "type should not be empty", provider_path: "distribution.bathrooms[0].type" }),
    ]);
    expect(result.metadata).toMatchObject({
      recognized_container_keys: ["error", "details", "message"],
      validation_map_nodes_seen: 1,
      validation_map_candidate_keys_seen: 1,
      validation_map_string_leaves_seen: 1,
      validation_map_string_array_leaves_seen: 1,
      validation_map_rule_maps_seen: 0,
      validation_map_nested_maps_seen: 0,
      details_object_count: 1,
      details_array_count: 0,
      details_string_count: 0,
      extracted_issue_count: 2,
    });
  });

  it("builds the same path from a nested field map and numeric key", () => {
    const result = parseAvantioProviderErrorWithMetadata(JSON.stringify(providerNestedFieldMapError));
    expect(result.issues.at(-1)).toMatchObject({
      code: "provider_validation_error",
      provider_path: "distribution.bathrooms[0].type",
      message: "type should not be empty",
    });
    expect(result.metadata).toMatchObject({
      validation_map_nodes_seen: 4,
      validation_map_candidate_keys_seen: 4,
      validation_map_string_leaves_seen: 1,
      validation_map_string_array_leaves_seen: 1,
      validation_map_nested_maps_seen: 3,
    });
  });

  it("classifies a field-to-rule map conservatively", () => {
    const result = parseAvantioProviderErrorWithMetadata(JSON.stringify(providerFieldRuleMapError));
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "provider_isdefined", provider_path: "distribution.bathrooms[0].type", message: "type is required" }),
      expect.objectContaining({ code: "provider_isenum", provider_path: "distribution.bathrooms[0].type", message: "type must contain an allowed value" }),
    ]);
    expect(result.metadata).toMatchObject({ validation_map_rule_maps_seen: 1, validation_map_string_leaves_seen: 2 });
  });

  it("parses arrays containing separate field maps", () => {
    const result = parseAvantioProviderErrorWithMetadata(JSON.stringify(providerFieldMapListError));
    expect(result.issues.map((issue) => issue.provider_path)).toEqual(["location.address", "capacity.maxAdults"]);
    expect(result.metadata).toMatchObject({
      validation_map_nodes_seen: 2,
      validation_map_candidate_keys_seen: 2,
      validation_map_string_leaves_seen: 2,
      validation_map_string_array_leaves_seen: 1,
      details_array_count: 1,
    });
  });

  it("treats ambiguous maps as nested fields with generic codes", () => {
    expect(parseAvantioProviderError(JSON.stringify({ details: {
      type: { requiredField: "Ambiguous validation" },
    } }))).toEqual([
      expect.objectContaining({ code: "provider_validation_error", provider_path: "type.requiredField", message: "Ambiguous validation" }),
    ]);
  });

  it("never traverses denied or sensitive validation-map keys", () => {
    const result = parseAvantioProviderErrorWithMetadata(JSON.stringify({ details: {
      target: { wifiPassword: "super-secret-target" },
      value: { apiKey: "super-secret-value" },
      payload: { owner: "private owner data" },
      authorization: "Bearer secret",
      "data.location": "dotted-data-secret",
      safeParent: { context: { location: "nested-secret" } },
    } }));
    const serialized = JSON.stringify(result);
    for (const forbidden of ["super-secret-target", "super-secret-value", "private owner data", "Bearer secret", "dotted-data-secret", "nested-secret", "wifiPassword", "apiKey", "owner", "authorization", "data.location", "context"]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(result.issues).toEqual([]);
    expect(result.metadata.ignored_sensitive_keys_seen).toBe(6);
  });

  it("ignores sensitive, binary-looking, and malformed map leaves", () => {
    const result = parseAvantioProviderErrorWithMetadata(JSON.stringify({ details: {
      locationAddress: "api_key=never-return-this",
      binaryValue: "a".repeat(200),
      numericValue: 123,
      booleanValue: true,
      nullValue: null,
    } }));
    expect(result.issues).toEqual([]);
    expect(result.metadata.ignored_unsupported_leaves_seen).toBe(5);
  });

  it("enforces depth and issue limits for validation maps", () => {
    let deep: unknown = "Too deep";
    for (let depth = 0; depth < 10; depth += 1) deep = { [`level${depth}`]: deep };
    expect(parseAvantioProviderError(JSON.stringify({ details: deep }))).toEqual([]);

    const many = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`field${index}`, `Issue ${index}`]));
    expect(parseAvantioProviderError(JSON.stringify({ details: many }))).toHaveLength(AVANTIO_PROVIDER_ERROR_MAX_ISSUES);
  });

  it("counts a string-shaped details container without exposing it as a field map", () => {
    const result = parseAvantioProviderErrorWithMetadata(JSON.stringify({ details: "Unsupported details text" }));
    expect(result.issues).toEqual([]);
    expect(result.metadata).toMatchObject({ details_object_count: 0, details_array_count: 0, details_string_count: 1 });
  });
});
