/** JSON Schema 도구 — JSON Schema 생성/검증/변환. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class JsonSchemaTool extends Tool {
  readonly name = "json_schema";
  readonly category = "data" as const;
  readonly description = "JSON Schema utilities: validate, generate, draft_convert, merge, diff, dereference.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["validate", "generate", "draft_convert", "merge", "diff", "dereference", "mock"], description: "Operation" },
      schema: { type: "string", description: "JSON Schema string" },
      data: { type: "string", description: "JSON data to validate" },
      target_draft: { type: "string", description: "Target draft version (draft-04, draft-07, 2020-12)" },
      schema2: { type: "string", description: "Second schema for merge/diff" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "validate");

    switch (action) {
      case "validate": {
        let schema: Record<string, unknown>;
        let data: unknown;
        try { schema = JSON.parse(String(params.schema || "{}")); } catch { return JSON.stringify({ error: "invalid schema JSON" }); }
        try { data = JSON.parse(String(params.data || "null")); } catch { return JSON.stringify({ error: "invalid data JSON" }); }
        const errors = this.validate_against_schema(data, schema, "");
        return JSON.stringify({ valid: errors.length === 0, errors });
      }
      case "generate": {
        let data: unknown;
        try { data = JSON.parse(String(params.data || "null")); } catch { return JSON.stringify({ error: "invalid JSON" }); }
        const schema = this.infer_schema(data);
        return JSON.stringify(schema, null, 2);
      }
      case "draft_convert": {
        let schema: Record<string, unknown>;
        try { schema = JSON.parse(String(params.schema || "{}")); } catch { return JSON.stringify({ error: "invalid schema JSON" }); }
        const target = String(params.target_draft || "2020-12");
        return JSON.stringify(this.convert_draft(schema, target), null, 2);
      }
      case "merge": {
        let s1: Record<string, unknown>, s2: Record<string, unknown>;
        try { s1 = JSON.parse(String(params.schema || "{}")); } catch { return JSON.stringify({ error: "invalid schema JSON" }); }
        try { s2 = JSON.parse(String(params.schema2 || "{}")); } catch { return JSON.stringify({ error: "invalid schema2 JSON" }); }
        return JSON.stringify(this.merge_schemas(s1, s2), null, 2);
      }
      case "diff": {
        let s1: Record<string, unknown>, s2: Record<string, unknown>;
        try { s1 = JSON.parse(String(params.schema || "{}")); } catch { return JSON.stringify({ error: "invalid schema JSON" }); }
        try { s2 = JSON.parse(String(params.schema2 || "{}")); } catch { return JSON.stringify({ error: "invalid schema2 JSON" }); }
        return JSON.stringify(this.diff_schemas(s1, s2));
      }
      case "dereference": {
        let schema: Record<string, unknown>;
        try { schema = JSON.parse(String(params.schema || "{}")); } catch { return JSON.stringify({ error: "invalid schema JSON" }); }
        return JSON.stringify(this.dereference(schema, schema), null, 2);
      }
      case "mock": {
        let schema: Record<string, unknown>;
        try { schema = JSON.parse(String(params.schema || "{}")); } catch { return JSON.stringify({ error: "invalid schema JSON" }); }
        return JSON.stringify(this.generate_mock(schema));
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private validate_against_schema(data: unknown, schema: Record<string, unknown>, path: string): string[] {
    const errors: string[] = [];
    const type = schema.type as string | undefined;
    if (type) {
      const actual = Array.isArray(data) ? "array" : data === null ? "null" : typeof data;
      if (type === "integer") {
        if (!Number.isInteger(data)) errors.push(`${path || "/"}: expected integer, got ${actual}`);
      } else if (actual !== type) {
        errors.push(`${path || "/"}: expected ${type}, got ${actual}`);
        return errors;
      }
    }
    if (type === "object" && data && typeof data === "object" && !Array.isArray(data)) {
      const obj = data as Record<string, unknown>;
      const props = (schema.properties || {}) as Record<string, Record<string, unknown>>;
      const required = (schema.required || []) as string[];
      for (const r of required) {
        if (!(r in obj)) errors.push(`${path}/${r}: required property missing`);
      }
      for (const [k, v] of Object.entries(obj)) {
        if (props[k]) errors.push(...this.validate_against_schema(v, props[k], `${path}/${k}`));
      }
    }
    if (type === "array" && Array.isArray(data) && schema.items) {
      const items = schema.items as Record<string, unknown>;
      for (let i = 0; i < data.length; i++) {
        errors.push(...this.validate_against_schema(data[i], items, `${path}/${i}`));
      }
    }
    if (schema.enum && Array.isArray(schema.enum)) {
      if (!schema.enum.includes(data)) errors.push(`${path || "/"}: value not in enum`);
    }
    if (type === "string" && typeof data === "string") {
      if (schema.minLength && data.length < (schema.minLength as number)) errors.push(`${path || "/"}: shorter than minLength`);
      if (schema.maxLength && data.length > (schema.maxLength as number)) errors.push(`${path || "/"}: longer than maxLength`);
      if (schema.pattern) {
        try { if (!new RegExp(schema.pattern as string).test(data)) errors.push(`${path || "/"}: pattern mismatch`); } catch { /* skip */ }
      }
    }
    if (type === "number" || type === "integer") {
      const n = data as number;
      if (schema.minimum !== undefined && n < (schema.minimum as number)) errors.push(`${path || "/"}: below minimum`);
      if (schema.maximum !== undefined && n > (schema.maximum as number)) errors.push(`${path || "/"}: above maximum`);
    }
    return errors;
  }

  private infer_schema(data: unknown): Record<string, unknown> {
    if (data === null) return { type: "null" };
    if (typeof data === "string") return { type: "string" };
    if (typeof data === "number") return Number.isInteger(data) ? { type: "integer" } : { type: "number" };
    if (typeof data === "boolean") return { type: "boolean" };
    if (Array.isArray(data)) {
      if (data.length === 0) return { type: "array", items: {} };
      return { type: "array", items: this.infer_schema(data[0]) };
    }
    if (typeof data === "object") {
      const obj = data as Record<string, unknown>;
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) props[k] = this.infer_schema(v);
      return { type: "object", properties: props, required: Object.keys(obj) };
    }
    return {};
  }

  private convert_draft(schema: Record<string, unknown>, target: string): Record<string, unknown> {
    const out = { ...schema };
    if (target === "2020-12") {
      out.$schema = "https://json-schema.org/draft/2020-12/schema";
      if (out.definitions) { out.$defs = out.definitions; delete out.definitions; }
    } else if (target === "draft-07") {
      out.$schema = "http://json-schema.org/draft-07/schema#";
      if (out.$defs) { out.definitions = out.$defs; delete out.$defs; }
    }
    return out;
  }

  private merge_schemas(s1: Record<string, unknown>, s2: Record<string, unknown>): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...s1 };
    if (s1.type === "object" && s2.type === "object") {
      const p1 = (s1.properties || {}) as Record<string, unknown>;
      const p2 = (s2.properties || {}) as Record<string, unknown>;
      merged.properties = { ...p1, ...p2 };
      const r1 = (s1.required || []) as string[];
      const r2 = (s2.required || []) as string[];
      merged.required = [...new Set([...r1, ...r2])];
    }
    return merged;
  }

  private diff_schemas(s1: Record<string, unknown>, s2: Record<string, unknown>): Record<string, unknown> {
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];
    const p1 = (s1.properties || {}) as Record<string, unknown>;
    const p2 = (s2.properties || {}) as Record<string, unknown>;
    for (const k of Object.keys(p2)) { if (!(k in p1)) added.push(k); }
    for (const k of Object.keys(p1)) {
      if (!(k in p2)) removed.push(k);
      else if (JSON.stringify(p1[k]) !== JSON.stringify(p2[k])) changed.push(k);
    }
    return { added, removed, changed, type_changed: s1.type !== s2.type };
  }

  private dereference(node: unknown, root: Record<string, unknown>): unknown {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((n) => this.dereference(n, root));
    const obj = node as Record<string, unknown>;
    if (obj.$ref && typeof obj.$ref === "string") {
      const ref = obj.$ref as string;
      if (ref.startsWith("#/")) {
        const parts = ref.slice(2).split("/");
        let cur: unknown = root;
        for (const p of parts) {
          if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[p];
          else return obj;
        }
        return this.dereference(cur, root);
      }
      return obj;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = this.dereference(v, root);
    return out;
  }

  private generate_mock(schema: Record<string, unknown>): unknown {
    const type = schema.type as string;
    switch (type) {
      case "string": return schema.enum ? (schema.enum as unknown[])[0] : "example";
      case "number": return schema.minimum != null ? schema.minimum : 0;
      case "integer": return schema.minimum != null ? schema.minimum : 0;
      case "boolean": return true;
      case "null": return null;
      case "array": {
        const items = schema.items as Record<string, unknown> | undefined;
        return items ? [this.generate_mock(items)] : [];
      }
      case "object": {
        const props = (schema.properties || {}) as Record<string, Record<string, unknown>>;
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(props)) out[k] = this.generate_mock(v);
        return out;
      }
      default: return null;
    }
  }
}
