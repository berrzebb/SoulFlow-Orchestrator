/** SO-4: SchemaChain validator/normalizer 테스트. */

import { describe, it, expect } from "vitest";
import {
  validate_schema,
  validate_json_output,
  normalize_json_text,
  type SchemaValidationError,
} from "../../src/orchestration/schema-validator.js";

// ── validate_schema ─────────────────────────────────────────────

describe("validate_schema", () => {
  it("valid object — no errors", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" }, age: { type: "number" } },
      required: ["name"],
    };
    const errors = validate_schema({ name: "Alice", age: 30 }, schema);
    expect(errors).toEqual([]);
  });

  it("missing required property", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    };
    const errors = validate_schema({}, schema);
    expect(errors.length).toBe(1);
    expect(errors[0].path).toBe("$.name");
    expect(errors[0].message).toContain("required");
  });

  it("wrong type", () => {
    const schema = { type: "string" };
    const errors = validate_schema(42, schema);
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("string");
  });

  it("nested object validation", () => {
    const schema = {
      type: "object",
      properties: {
        address: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    };
    const errors = validate_schema({ address: {} }, schema);
    expect(errors.length).toBe(1);
    expect(errors[0].path).toBe("$.address.city");
  });

  it("array items validation", () => {
    const schema = {
      type: "array",
      items: { type: "number" },
    };
    const errors = validate_schema([1, "two", 3], schema);
    expect(errors.length).toBe(1);
    expect(errors[0].path).toBe("$[1]");
  });

  it("string minLength / maxLength", () => {
    const schema = { type: "string", minLength: 3, maxLength: 5 };
    expect(validate_schema("ab", schema).length).toBe(1);
    expect(validate_schema("abc", schema)).toEqual([]);
    expect(validate_schema("abcdef", schema).length).toBe(1);
  });

  it("string pattern", () => {
    const schema = { type: "string", pattern: "^\\d+$" };
    expect(validate_schema("123", schema)).toEqual([]);
    expect(validate_schema("abc", schema).length).toBe(1);
  });

  it("number minimum / maximum", () => {
    const schema = { type: "number", minimum: 0, maximum: 100 };
    expect(validate_schema(50, schema)).toEqual([]);
    expect(validate_schema(-1, schema).length).toBe(1);
    expect(validate_schema(101, schema).length).toBe(1);
  });

  it("enum validation", () => {
    const schema = { type: "string", enum: ["a", "b", "c"] };
    expect(validate_schema("a", schema)).toEqual([]);
    expect(validate_schema("d", schema).length).toBe(1);
  });

  it("integer validation", () => {
    const schema = { type: "integer" };
    expect(validate_schema(42, schema)).toEqual([]);
    expect(validate_schema(3.14, schema).length).toBe(1);
  });

  it("null type", () => {
    const schema = { type: "null" };
    expect(validate_schema(null, schema)).toEqual([]);
    expect(validate_schema("not null", schema).length).toBe(1);
  });

  it("empty schema — anything passes", () => {
    expect(validate_schema("hello", {})).toEqual([]);
    expect(validate_schema(42, {})).toEqual([]);
    expect(validate_schema(null, {})).toEqual([]);
  });

  it("array minItems / maxItems", () => {
    const schema = { type: "array", items: { type: "number" }, minItems: 2, maxItems: 4 };
    expect(validate_schema([1], schema).length).toBe(1);
    expect(validate_schema([1, 2], schema)).toEqual([]);
    expect(validate_schema([1, 2, 3, 4, 5], schema).length).toBe(1);
  });
});

// ── normalize_json_text ─────────────────────────────────────────

describe("normalize_json_text", () => {
  it("strips ```json``` fences", () => {
    const raw = '```json\n{"key": "value"}\n```';
    expect(normalize_json_text(raw)).toBe('{"key": "value"}');
  });

  it("strips ``` fences without language", () => {
    const raw = '```\n{"key": "value"}\n```';
    expect(normalize_json_text(raw)).toBe('{"key": "value"}');
  });

  it("returns plain JSON unchanged", () => {
    const raw = '{"key": "value"}';
    expect(normalize_json_text(raw)).toBe('{"key": "value"}');
  });

  it("trims whitespace", () => {
    const raw = '  \n  {"key": "value"}  \n  ';
    expect(normalize_json_text(raw)).toBe('{"key": "value"}');
  });
});

// ── validate_json_output ────────────────────────────────────────

describe("validate_json_output", () => {
  const schema = {
    type: "object",
    properties: { name: { type: "string" }, score: { type: "number" } },
    required: ["name"],
  };

  it("valid JSON matching schema → parsed + no errors", () => {
    const result = validate_json_output('{"name": "Alice", "score": 95}', schema);
    expect(result).not.toBeNull();
    expect(result!.errors).toEqual([]);
    expect(result!.parsed).toEqual({ name: "Alice", score: 95 });
  });

  it("valid JSON not matching schema → parsed + errors", () => {
    const result = validate_json_output('{"score": "bad"}', schema);
    expect(result).not.toBeNull();
    expect(result!.errors.length).toBeGreaterThan(0);
    expect(result!.parsed).toEqual({ score: "bad" });
  });

  it("invalid JSON → null", () => {
    expect(validate_json_output("not json at all", schema)).toBeNull();
  });

  it("empty string → null", () => {
    expect(validate_json_output("", schema)).toBeNull();
  });

  it("code-fenced JSON → strips fences and validates", () => {
    const raw = '```json\n{"name": "Bob"}\n```';
    const result = validate_json_output(raw, schema);
    expect(result).not.toBeNull();
    expect(result!.errors).toEqual([]);
    expect(result!.parsed).toEqual({ name: "Bob" });
  });

  it("valid JSON with wrong property type → errors include path", () => {
    const result = validate_json_output('{"name": 123}', schema);
    expect(result).not.toBeNull();
    expect(result!.errors.some((e: SchemaValidationError) => e.path === "$.name")).toBe(true);
  });
});
