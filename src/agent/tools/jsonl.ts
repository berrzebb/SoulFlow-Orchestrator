/** JSONL 도구 — JSON Lines 파싱/생성/필터/통계. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class JsonlTool extends Tool {
  readonly name = "jsonl";
  readonly category = "data" as const;
  readonly description = "JSON Lines utilities: parse, generate, filter, count, head, tail, map, unique.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["parse", "generate", "filter", "count", "head", "tail", "map", "unique"], description: "JSONL operation" },
      input: { type: "string", description: "JSONL string (one JSON per line)" },
      data: { type: "string", description: "JSON array string (for generate)" },
      field: { type: "string", description: "Field name for filter/map/unique" },
      value: { type: "string", description: "Value for filter matching" },
      count: { type: "integer", description: "Number of lines for head/tail (default: 10)" },
      expression: { type: "string", description: "Field to extract for map" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "parse");
    const input = String(params.input || "");

    switch (action) {
      case "parse": {
        const lines = this.parse_lines(input);
        return JSON.stringify({ records: lines, count: lines.length });
      }
      case "generate": {
        try {
          const arr = JSON.parse(String(params.data || "[]"));
          if (!Array.isArray(arr)) return "Error: data must be a JSON array";
          const jsonl = arr.map((item) => JSON.stringify(item)).join("\n");
          return jsonl;
        } catch {
          return "Error: invalid JSON data";
        }
      }
      case "filter": {
        const field = String(params.field || "");
        const value = String(params.value || "");
        if (!field) return "Error: field is required";
        const lines = this.parse_lines(input);
        const filtered = lines.filter((item) => {
          const v = this.get_field(item, field);
          return String(v) === value;
        });
        return JSON.stringify({ records: filtered, count: filtered.length, total: lines.length });
      }
      case "count": {
        const lines = input.split("\n").filter((l) => l.trim()).length;
        return JSON.stringify({ count: lines });
      }
      case "head": {
        const n = Math.max(1, Number(params.count) || 10);
        const lines = this.parse_lines(input).slice(0, n);
        return JSON.stringify({ records: lines, count: lines.length });
      }
      case "tail": {
        const n = Math.max(1, Number(params.count) || 10);
        const lines = this.parse_lines(input);
        const result = lines.slice(-n);
        return JSON.stringify({ records: result, count: result.length });
      }
      case "map": {
        const field = String(params.expression || params.field || "");
        if (!field) return "Error: field or expression is required";
        const lines = this.parse_lines(input);
        const values = lines.map((item) => this.get_field(item, field));
        return JSON.stringify({ values, count: values.length });
      }
      case "unique": {
        const field = String(params.field || "");
        if (!field) return "Error: field is required";
        const lines = this.parse_lines(input);
        const seen = new Set<string>();
        const unique: unknown[] = [];
        for (const item of lines) {
          const v = String(this.get_field(item, field));
          if (!seen.has(v)) { seen.add(v); unique.push(item); }
        }
        return JSON.stringify({ records: unique, count: unique.length, total: lines.length });
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private parse_lines(input: string): unknown[] {
    return input.split("\n").filter((l) => l.trim()).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter((v) => v !== null);
  }

  private get_field(obj: unknown, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
}
