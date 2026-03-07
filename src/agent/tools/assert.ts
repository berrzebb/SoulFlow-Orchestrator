/** Assert 도구 — 런타임 값 검증 (워크플로우/에이전트 데이터 파이프라인 검증). */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class AssertTool extends Tool {
  readonly name = "assert";
  readonly category = "data" as const;
  readonly description = "Runtime value assertions: eq, neq, type_is, truthy, falsy, contains, matches, range, length, schema.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["eq", "neq", "type_is", "truthy", "falsy", "contains", "matches", "range", "length", "schema"], description: "Assertion type" },
      value: { type: "string", description: "Value to check (JSON string for objects/arrays)" },
      expected: { type: "string", description: "Expected value or type (depends on action)" },
      message: { type: "string", description: "Custom error message on failure" },
      min: { type: "number", description: "Min value (for range/length)" },
      max: { type: "number", description: "Max value (for range/length)" },
    },
    required: ["action", "value"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "truthy");
    const raw = String(params.value ?? "");
    const expected = String(params.expected ?? "");
    const message = String(params.message || "");

    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = raw; }

    let pass = false;
    let detail = "";

    switch (action) {
      case "eq":
        pass = JSON.stringify(parsed) === JSON.stringify(this.try_parse(expected));
        detail = `expected ${expected}, got ${raw}`;
        break;
      case "neq":
        pass = JSON.stringify(parsed) !== JSON.stringify(this.try_parse(expected));
        detail = `expected not ${expected}`;
        break;
      case "type_is": {
        const actual_type = Array.isArray(parsed) ? "array" : parsed === null ? "null" : typeof parsed;
        pass = actual_type === expected;
        detail = `expected type ${expected}, got ${actual_type}`;
        break;
      }
      case "truthy":
        pass = !!parsed;
        detail = `value is ${parsed ? "truthy" : "falsy"}`;
        break;
      case "falsy":
        pass = !parsed;
        detail = `value is ${parsed ? "truthy" : "falsy"}`;
        break;
      case "contains":
        if (typeof parsed === "string") pass = parsed.includes(expected);
        else if (Array.isArray(parsed)) pass = parsed.some((i) => String(i) === expected);
        detail = pass ? "contains match" : `does not contain "${expected}"`;
        break;
      case "matches":
        try { pass = new RegExp(expected).test(String(parsed)); } catch { pass = false; }
        detail = pass ? "regex match" : `does not match /${expected}/`;
        break;
      case "range": {
        const num = Number(parsed);
        const min = Number(params.min ?? -Infinity);
        const max = Number(params.max ?? Infinity);
        pass = Number.isFinite(num) && num >= min && num <= max;
        detail = `${num} in [${min}, ${max}]: ${pass}`;
        break;
      }
      case "length": {
        const len = typeof parsed === "string" ? parsed.length : Array.isArray(parsed) ? parsed.length : 0;
        const min = Number(params.min ?? 0);
        const max = Number(params.max ?? Infinity);
        pass = len >= min && len <= max;
        detail = `length ${len} in [${min}, ${max}]: ${pass}`;
        break;
      }
      case "schema":
        pass = this.check_schema(parsed, expected);
        detail = pass ? "schema valid" : "schema validation failed";
        break;
      default:
        return `Error: unsupported action "${action}"`;
    }

    return JSON.stringify({
      pass,
      action,
      detail: message || detail,
    });
  }

  private try_parse(s: string): unknown {
    try { return JSON.parse(s); } catch { return s; }
  }

  private check_schema(value: unknown, schema_str: string): boolean {
    try {
      const schema = JSON.parse(schema_str) as Record<string, unknown>;
      return this.validate_type(value, schema);
    } catch {
      return false;
    }
  }

  private validate_type(value: unknown, schema: Record<string, unknown>): boolean {
    const type = schema.type as string | undefined;
    if (!type) return true;
    const actual = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
    if (actual !== type) return false;

    if (type === "object" && value && typeof value === "object" && schema.required) {
      const req = schema.required as string[];
      for (const key of req) {
        if (!(key in (value as Record<string, unknown>))) return false;
      }
    }
    return true;
  }
}
