/** Validator 도구 — JSON Schema 검증 + 포맷 검증(email/url/ip/date) + 커스텀 룰. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s/$.?#].\S*$/i;
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ValidationError = { path: string; message: string; value?: unknown };

export class ValidatorTool extends Tool {
  readonly name = "validator";
  readonly category = "memory" as const;
  readonly description =
    "Validate data against JSON Schema or format rules (email, url, ip, date, uuid). Returns structured errors.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["schema", "format", "rules"],
        description: "schema: JSON Schema validation, format: single format check, rules: multiple rule checks",
      },
      input: { type: "string", description: "Data to validate (JSON string)" },
      schema: { type: "string", description: "JSON Schema (for schema operation)" },
      format: { type: "string", enum: ["email", "url", "ip", "date", "uuid", "json", "number"], description: "Format to validate (for format operation)" },
      rules: { type: "string", description: "JSON array of rules: [{field, type, required?, min?, max?, pattern?}]" },
    },
    required: ["operation", "input"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const op = String(params.operation || "format");
    const input = String(params.input || "");
    if (!input.trim()) return "Error: input is required";

    switch (op) {
      case "schema": return this.validate_schema(input, String(params.schema || "{}"));
      case "format": return this.validate_format(input, String(params.format || "json"));
      case "rules": return this.validate_rules(input, String(params.rules || "[]"));
      default: return `Error: unsupported operation "${op}"`;
    }
  }

  private validate_schema(input: string, schema_str: string): string {
    let data: unknown;
    let schema: Record<string, unknown>;
    try { data = JSON.parse(input); } catch { return this.result(false, [{ path: "$", message: "invalid JSON input" }]); }
    try { schema = JSON.parse(schema_str); } catch { return this.result(false, [{ path: "$", message: "invalid JSON Schema" }]); }

    const errors = this.check_schema(data, schema, "$");
    return this.result(errors.length === 0, errors);
  }

  private check_schema(data: unknown, schema: Record<string, unknown>, path: string): ValidationError[] {
    const errors: ValidationError[] = [];
    const expected_type = schema.type as string | undefined;

    if (expected_type) {
      const actual = this.json_type(data);
      if (expected_type === "integer") {
        if (!Number.isInteger(data)) errors.push({ path, message: `expected integer, got ${actual}`, value: data });
      } else if (actual !== expected_type) {
        errors.push({ path, message: `expected ${expected_type}, got ${actual}`, value: data });
        return errors;
      }
    }

    if (expected_type === "object" && typeof data === "object" && data !== null && !Array.isArray(data)) {
      const obj = data as Record<string, unknown>;
      const required = (schema.required || []) as string[];
      const props = (schema.properties || {}) as Record<string, Record<string, unknown>>;

      for (const key of required) {
        if (!(key in obj)) errors.push({ path: `${path}.${key}`, message: "required field missing" });
      }
      for (const [key, prop_schema] of Object.entries(props)) {
        if (key in obj) errors.push(...this.check_schema(obj[key], prop_schema, `${path}.${key}`));
      }
    }

    if (expected_type === "array" && Array.isArray(data)) {
      const items = schema.items as Record<string, unknown> | undefined;
      if (items) data.forEach((item, i) => errors.push(...this.check_schema(item, items, `${path}[${i}]`)));
      if (schema.minItems && data.length < (schema.minItems as number)) errors.push({ path, message: `array too short (min ${schema.minItems})` });
      if (schema.maxItems && data.length > (schema.maxItems as number)) errors.push({ path, message: `array too long (max ${schema.maxItems})` });
    }

    if (typeof data === "string") {
      if (schema.minLength && data.length < (schema.minLength as number)) errors.push({ path, message: `string too short (min ${schema.minLength})` });
      if (schema.maxLength && data.length > (schema.maxLength as number)) errors.push({ path, message: `string too long (max ${schema.maxLength})` });
      if (schema.pattern) {
        try { if (!new RegExp(schema.pattern as string).test(data)) errors.push({ path, message: `pattern mismatch: ${schema.pattern}` }); } catch { /* skip */ }
      }
      if (schema.enum && !(schema.enum as unknown[]).includes(data)) errors.push({ path, message: `value not in enum: ${JSON.stringify(schema.enum)}` });
    }

    if (typeof data === "number") {
      if (schema.minimum !== undefined && data < (schema.minimum as number)) errors.push({ path, message: `below minimum ${schema.minimum}` });
      if (schema.maximum !== undefined && data > (schema.maximum as number)) errors.push({ path, message: `above maximum ${schema.maximum}` });
    }

    return errors;
  }

  private validate_format(input: string, format: string): string {
    switch (format) {
      case "email": return this.result(EMAIL_RE.test(input.trim()), EMAIL_RE.test(input.trim()) ? [] : [{ path: "$", message: "invalid email format" }]);
      case "url": return this.result(URL_RE.test(input.trim()), URL_RE.test(input.trim()) ? [] : [{ path: "$", message: "invalid URL format" }]);
      case "ip": return this.result(this.is_valid_ip(input.trim()), this.is_valid_ip(input.trim()) ? [] : [{ path: "$", message: "invalid IP address" }]);
      case "date": return this.result(ISO_DATE_RE.test(input.trim()), ISO_DATE_RE.test(input.trim()) ? [] : [{ path: "$", message: "invalid ISO date format" }]);
      case "uuid": return this.result(UUID_RE.test(input.trim()), UUID_RE.test(input.trim()) ? [] : [{ path: "$", message: "invalid UUID format" }]);
      case "json": { try { JSON.parse(input); return this.result(true, []); } catch { return this.result(false, [{ path: "$", message: "invalid JSON" }]); } }
      case "number": return this.result(!isNaN(Number(input.trim())), isNaN(Number(input.trim())) ? [{ path: "$", message: "not a valid number" }] : []);
      default: return `Error: unsupported format "${format}"`;
    }
  }

  private validate_rules(input: string, rules_str: string): string {
    let data: Record<string, unknown>;
    let rules: Array<Record<string, unknown>>;
    try { data = JSON.parse(input); } catch { return this.result(false, [{ path: "$", message: "invalid JSON input" }]); }
    try { rules = JSON.parse(rules_str); } catch { return this.result(false, [{ path: "$", message: "invalid rules JSON" }]); }
    if (!Array.isArray(rules)) return this.result(false, [{ path: "$", message: "rules must be an array" }]);

    const errors: ValidationError[] = [];
    for (const rule of rules) {
      const field = String(rule.field || "");
      if (!field) continue;
      const value = data[field];
      const path = `$.${field}`;

      if (rule.required && (value === undefined || value === null || value === "")) {
        errors.push({ path, message: "required" });
        continue;
      }
      if (value === undefined || value === null) continue;

      if (rule.type) {
        const actual = this.json_type(value);
        if (actual !== rule.type) errors.push({ path, message: `expected ${rule.type}, got ${actual}`, value });
      }
      if (rule.min !== undefined && typeof value === "number" && value < (rule.min as number)) {
        errors.push({ path, message: `below minimum ${rule.min}`, value });
      }
      if (rule.max !== undefined && typeof value === "number" && value > (rule.max as number)) {
        errors.push({ path, message: `above maximum ${rule.max}`, value });
      }
      if (rule.pattern && typeof value === "string") {
        try { if (!new RegExp(rule.pattern as string).test(value)) errors.push({ path, message: `pattern mismatch: ${rule.pattern}`, value }); } catch { /* skip */ }
      }
      if (rule.format && typeof value === "string") {
        const fmt_result = JSON.parse(this.validate_format(value, rule.format as string));
        if (!fmt_result.valid) errors.push({ path, message: `invalid ${rule.format} format`, value });
      }
    }

    return this.result(errors.length === 0, errors);
  }

  private is_valid_ip(s: string): boolean {
    if (!IPV4_RE.test(s)) return false;
    return s.split(".").every((p) => { const n = parseInt(p, 10); return n >= 0 && n <= 255; });
  }

  private json_type(val: unknown): string {
    if (val === null) return "null";
    if (Array.isArray(val)) return "array";
    return typeof val;
  }

  private result(valid: boolean, errors: ValidationError[]): string {
    return JSON.stringify({ valid, error_count: errors.length, errors: errors.slice(0, 50) }, null, 2);
  }
}
