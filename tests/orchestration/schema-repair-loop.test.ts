/** SO-5: Bounded SchemaRepairLoop 테스트. */

import { describe, it, expect, vi } from "vitest";
import {
  run_schema_repair,
  format_repair_prompt,
  DEFAULT_MAX_REPAIR_ATTEMPTS,
} from "../../src/orchestration/schema-repair-loop.js";

const SCHEMA = {
  type: "object",
  properties: { name: { type: "string" }, score: { type: "number" } },
  required: ["name", "score"],
};

describe("run_schema_repair", () => {
  it("valid initial output → no retries", async () => {
    const retry = vi.fn();
    const result = await run_schema_repair(retry, SCHEMA, '{"name": "Alice", "score": 95}');

    expect(result.errors).toEqual([]);
    expect(result.parsed).toEqual({ name: "Alice", score: 95 });
    expect(result.attempts).toBe(0);
    expect(retry).not.toHaveBeenCalled();
  });

  it("invalid initial → repair succeeds on first retry", async () => {
    const retry = vi.fn().mockResolvedValueOnce('{"name": "Bob", "score": 80}');
    const result = await run_schema_repair(retry, SCHEMA, '{"name": "Alice"}');

    expect(result.errors).toEqual([]);
    expect(result.parsed).toEqual({ name: "Bob", score: 80 });
    expect(result.attempts).toBe(1);
    expect(retry).toHaveBeenCalledOnce();
  });

  it("invalid initial → repair fails → exhausts max_attempts", async () => {
    const retry = vi.fn()
      .mockResolvedValueOnce('{"name": "Alice"}')  // still missing score
      .mockResolvedValueOnce('{"name": "Bob"}');     // still missing score

    const result = await run_schema_repair(retry, SCHEMA, '{"oops": true}');

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.attempts).toBe(DEFAULT_MAX_REPAIR_ATTEMPTS);
    expect(retry).toHaveBeenCalledTimes(DEFAULT_MAX_REPAIR_ATTEMPTS);
  });

  it("non-JSON initial → attempts repair", async () => {
    const retry = vi.fn().mockResolvedValueOnce('{"name": "Fixed", "score": 1}');
    const result = await run_schema_repair(retry, SCHEMA, "not json");

    expect(result.errors).toEqual([]);
    expect(result.parsed).toEqual({ name: "Fixed", score: 1 });
    expect(result.attempts).toBe(1);
  });

  it("custom max_attempts = 1", async () => {
    const retry = vi.fn().mockResolvedValueOnce('{"still": "bad"}');
    const result = await run_schema_repair(retry, SCHEMA, '{"oops": true}', 1);

    expect(retry).toHaveBeenCalledTimes(1);
    expect(result.attempts).toBe(1);
  });

  it("max_attempts = 0 → no retries, returns initial validation", async () => {
    const retry = vi.fn();
    const result = await run_schema_repair(retry, SCHEMA, '{"name": "Alice"}', 0);

    expect(retry).not.toHaveBeenCalled();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.attempts).toBe(0);
  });

  it("retry returns non-JSON → skips and continues", async () => {
    const retry = vi.fn()
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce('{"name": "OK", "score": 10}');

    const result = await run_schema_repair(retry, SCHEMA, '{"oops": true}');

    expect(result.errors).toEqual([]);
    expect(result.parsed).toEqual({ name: "OK", score: 10 });
    expect(result.attempts).toBe(2);
  });

  it("retry callback receives last_content and repair_prompt", async () => {
    const retry = vi.fn().mockResolvedValueOnce('{"name": "OK", "score": 5}');
    await run_schema_repair(retry, SCHEMA, '{"bad": true}');

    expect(retry).toHaveBeenCalledWith(
      '{"bad": true}',
      expect.stringContaining("schema validation errors"),
    );
  });

  it("code-fenced initial output → strips and validates", async () => {
    const retry = vi.fn();
    const result = await run_schema_repair(
      retry, SCHEMA,
      '```json\n{"name": "Alice", "score": 42}\n```',
    );

    expect(result.errors).toEqual([]);
    expect(result.parsed).toEqual({ name: "Alice", score: 42 });
    expect(retry).not.toHaveBeenCalled();
  });
});

describe("format_repair_prompt", () => {
  it("includes error paths and messages", () => {
    const errors = [
      { path: "$.name", message: "required field missing" },
      { path: "$.score", message: "expected number, got string" },
    ];
    const prompt = format_repair_prompt(errors, SCHEMA);

    expect(prompt).toContain("$.name");
    expect(prompt).toContain("required field missing");
    expect(prompt).toContain("$.score");
    expect(prompt).toContain("expected number, got string");
  });

  it("includes schema in prompt", () => {
    const errors = [{ path: "$", message: "invalid" }];
    const prompt = format_repair_prompt(errors, SCHEMA);

    expect(prompt).toContain('"name"');
    expect(prompt).toContain('"score"');
  });
});

describe("DEFAULT_MAX_REPAIR_ATTEMPTS", () => {
  it("is 2", () => {
    expect(DEFAULT_MAX_REPAIR_ATTEMPTS).toBe(2);
  });
});
