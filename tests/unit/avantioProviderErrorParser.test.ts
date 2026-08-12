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
  providerConstraintDescriptorError,
  providerFieldMapArrayError,
  providerFieldMapListError,
  providerFieldRuleMapError,
  providerNestedFieldMapError,
  providerKitchenApplianceConstraintError,
  providerKitchenTypeConstraintError,
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
      validation_map_constraint_descriptor_maps_seen: 0,
      validation_map_constraint_descriptor_leaves_seen: 0,
      ignored_sensitive_keys_seen: 0,
      ignored_unsupported_leaves_seen: 0,
      unsupported_leaf_null_count: 0,
      unsupported_leaf_boolean_count: 0,
      unsupported_leaf_number_count: 0,
      unsupported_leaf_array_count: 0,
      unsupported_leaf_object_count: 0,
      validation_map_invalid_path_keys_seen: 0,
      invalid_path_contains_dot_numeric_segment: 0,
      invalid_path_starts_with_dollar: 0,
      invalid_path_contains_numeric_bracket: 0,
      invalid_path_contains_quoted_bracket: 0,
      invalid_path_contains_space: 0,
      invalid_path_contains_colon: 0,
      invalid_path_contains_wildcard: 0,
      invalid_path_contains_parentheses: 0,
      safe_candidate_provider_paths: [],
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

  it("normalizes dotted numeric array segments while preserving existing path forms", () => {
    const issues = parseAvantioProviderError(JSON.stringify({ details: {
      "services.0.terms": "Terms are invalid",
      "distribution.bathrooms.0.type": "Bathroom type is invalid",
      "distribution.bedrooms.1.beds.0.type": "Bed type is invalid",
      "foo[0].bar": "Bracket path is invalid",
      "/foo/0/bar": "Pointer path is invalid",
    } }));

    expect(issues.map((issue) => issue.provider_path)).toEqual([
      "services[0].terms",
      "distribution.bathrooms[0].type",
      "distribution.bedrooms[1].beds[0].type",
      "foo[0].bar",
      "foo[0].bar",
    ]);
  });

  it("parses constraint descriptors beneath dotted numeric array paths", () => {
    const issues = parseAvantioProviderError(JSON.stringify({ details: {
      "services.0.terms.application.quantity": { min: 1 },
      "distribution.bedrooms.1.beds.0.type": { in: ["DOUBLE", "SINGLE"] },
    } }));

    expect(issues).toEqual([
      expect.objectContaining({
        provider_path: "services[0].terms.application.quantity",
        code: "provider_min",
      }),
      expect.objectContaining({
        provider_path: "distribution.bedrooms[1].beds[0].type",
        code: "provider_in",
      }),
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

  it("parses the six-leaf production constraint descriptor shape at the parent field path", () => {
    const result = parseAvantioProviderErrorWithMetadata(JSON.stringify(providerConstraintDescriptorError));
    const fieldIssues = result.issues.filter((issue) => issue.provider_path === "capacity.maxAdults");
    expect(fieldIssues).toEqual([
      expect.objectContaining({ code: "provider_min", message: "Valor mínimo permitido pela Avantio: 1." }),
      expect.objectContaining({ code: "provider_max", message: "Valor máximo permitido pela Avantio: 20." }),
      expect.objectContaining({ code: "provider_required", message: "Campo obrigatório para a Avantio." }),
      expect.objectContaining({ code: "provider_integer", message: "A Avantio exige um número inteiro." }),
      expect.objectContaining({ code: "provider_nullable", message: "A Avantio não aceita valor nulo neste campo." }),
      expect.objectContaining({ code: "provider_invalid", message: "A Avantio rejeitou este campo pela restrição 'invalid'." }),
    ]);
    expect(fieldIssues.every((issue) => !/\.(?:min|max|required|integer|nullable|invalid)$/.test(issue.provider_path ?? ""))).toBe(true);
    expect(result.metadata).toMatchObject({
      recognized_container_keys: ["error", "details", "message"],
      validation_map_nodes_seen: 2,
      validation_map_candidate_keys_seen: 1,
      validation_map_nested_maps_seen: 0,
      validation_map_constraint_descriptor_maps_seen: 1,
      validation_map_constraint_descriptor_leaves_seen: 6,
      ignored_unsupported_leaves_seen: 0,
      unsupported_leaf_boolean_count: 0,
      unsupported_leaf_number_count: 0,
      details_object_count: 1,
      details_array_count: 0,
      safe_candidate_provider_paths: ["capacity.maxAdults"],
      extracted_issue_count: 7,
    });
  });

  it("turns an in descriptor array into one issue without adding a rule path suffix", () => {
    const result = parseAvantioProviderErrorWithMetadata(JSON.stringify(providerKitchenTypeConstraintError));
    expect(result.issues).toEqual([{
      code: "provider_in",
      message: "Valores permitidos pela Avantio: AMERICAN, INDEPENDENT.",
      canonical_path: null,
      provider_path: "distribution.kitchens.type",
      section: "provider",
    }]);
    expect(result.metadata).toMatchObject({
      validation_map_constraint_descriptor_maps_seen: 1,
      validation_map_constraint_descriptor_leaves_seen: 1,
      validation_map_string_leaves_seen: 0,
      validation_map_string_array_leaves_seen: 0,
      safe_candidate_provider_paths: ["distribution.kitchens.type"],
    });
  });

  it("emits one bounded provider_in issue for the kitchen appliance enum list", () => {
    const issues = parseAvantioProviderError(JSON.stringify(providerKitchenApplianceConstraintError));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "provider_in", provider_path: "distribution.kitchens.appliances" });
    expect(issues[0].message).toContain("FRIDGE, FREEZER, OVEN");
    expect(issues[0].message).toContain("ELECTRIC_KETTLE");
  });

  it("supports enum, isInt, and other normalized descriptor rule identifiers", () => {
    const result = parseAvantioProviderError(JSON.stringify({ details: {
      age: { isInt: true, minimum: 1, maximum: 120 },
      mode: { enum: ["A", "B"] },
    } }));
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "provider_isint", provider_path: "age" }),
      expect.objectContaining({ code: "provider_minimum", provider_path: "age" }),
      expect.objectContaining({ code: "provider_maximum", provider_path: "age" }),
      expect.objectContaining({ code: "provider_enum", provider_path: "mode", message: "Valores permitidos pela Avantio: A, B." }),
    ]));
  });

  it("ignores unknown descriptor scalars and denies submitted-value aliases", () => {
    const privateValue = "private submitted value";
    const result = parseAvantioProviderErrorWithMetadata(JSON.stringify({ details: {
      someField: {
        required: true,
        unknownRule: 42,
        value: privateValue,
        actual: privateValue,
        given: privateValue,
        received: privateValue,
        submitted: privateValue,
        provided: privateValue,
        payload: { privateValue },
        token: "secret",
      },
    } }));
    expect(result.issues).toEqual([expect.objectContaining({ code: "provider_required", provider_path: "someField" })]);
    expect(JSON.stringify(result)).not.toContain(privateValue);
    expect(result.metadata).toMatchObject({
      ignored_sensitive_keys_seen: 8,
      ignored_unsupported_leaves_seen: 1,
      unsupported_leaf_number_count: 1,
      safe_candidate_provider_paths: ["someField"],
    });
  });

  it("counts unsupported leaf types and records only valid candidate provider paths", () => {
    const result = parseAvantioProviderErrorWithMetadata(JSON.stringify({ details: {
      safeField: {
        required: true,
        unknownNull: null,
        unknownBoolean: true,
        unknownNumber: 1,
        unknownArray: [1, 2],
        unknownObject: { nested: "ignored" },
      },
      "not a valid path": { hidden: true },
    } }));
    expect(result.issues).toEqual([expect.objectContaining({ code: "provider_required", provider_path: "safeField" })]);
    expect(result.metadata).toMatchObject({
      unsupported_leaf_null_count: 1,
      unsupported_leaf_boolean_count: 1,
      unsupported_leaf_number_count: 1,
      unsupported_leaf_array_count: 1,
      unsupported_leaf_object_count: 1,
      validation_map_invalid_path_keys_seen: 1,
    });
    expect(result.metadata.safe_candidate_provider_paths).toEqual(["safeField"]);
    expect(result.metadata.safe_candidate_provider_paths).not.toContain("not a valid path");
  });

  it("reports only structural counters for invalid provider-path shapes", () => {
    const invalidKeys = [
      "bad.0.path with-space",
      "$.private",
      "field[0]:bad",
      "field['private']",
      "field.*",
      "field(call)",
    ];
    const result = parseAvantioProviderErrorWithMetadata(JSON.stringify({
      details: Object.fromEntries(invalidKeys.map((key) => [key, "private response value"])),
    }));

    expect(result.issues).toEqual([]);
    expect(result.metadata).toMatchObject({
      validation_map_invalid_path_keys_seen: 6,
      invalid_path_contains_dot_numeric_segment: 1,
      invalid_path_starts_with_dollar: 1,
      invalid_path_contains_numeric_bracket: 1,
      invalid_path_contains_quoted_bracket: 1,
      invalid_path_contains_space: 1,
      invalid_path_contains_colon: 1,
      invalid_path_contains_wildcard: 1,
      invalid_path_contains_parentheses: 1,
    });
    const serializedMetadata = JSON.stringify(result.metadata);
    for (const key of invalidKeys) expect(serializedMetadata).not.toContain(key);
    expect(serializedMetadata).not.toContain("private response value");
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
    expect(result.metadata).toMatchObject({
      unsupported_leaf_null_count: 1,
      unsupported_leaf_boolean_count: 1,
      unsupported_leaf_number_count: 1,
    });
  });

  it("enforces depth and issue limits for validation maps", () => {
    let deep: unknown = "Too deep";
    for (let depth = 0; depth < 10; depth += 1) deep = { [`level${depth}`]: deep };
    expect(parseAvantioProviderError(JSON.stringify({ details: deep }))).toEqual([]);

    const many = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`field${index}`, `Issue ${index}`]));
    expect(parseAvantioProviderError(JSON.stringify({ details: many }))).toHaveLength(AVANTIO_PROVIDER_ERROR_MAX_ISSUES);

    const candidates = parseAvantioProviderErrorWithMetadata(JSON.stringify({
      details: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`field${index}`, null])),
    }));
    expect(candidates.metadata.safe_candidate_provider_paths).toHaveLength(20);
    expect(candidates.metadata.safe_candidate_provider_paths).toEqual(Array.from({ length: 20 }, (_, index) => `field${index}`));
  });

  it("counts a string-shaped details container without exposing it as a field map", () => {
    const result = parseAvantioProviderErrorWithMetadata(JSON.stringify({ details: "Unsupported details text" }));
    expect(result.issues).toEqual([]);
    expect(result.metadata).toMatchObject({ details_object_count: 0, details_array_count: 0, details_string_count: 1 });
  });
});
