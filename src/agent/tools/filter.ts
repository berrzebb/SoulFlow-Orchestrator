/** Filter 도구 — 배열/객체 필터링. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class FilterTool extends Tool {
  readonly name = "filter";
  readonly category = "data" as const;
  readonly description = "Filter arrays/objects with expressions. Actions: where, find, reject, every, some, count.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["where", "find", "reject", "every", "some", "count"], description: "Filter operation" },
      data: { type: "string", description: "JSON array string" },
      path: { type: "string", description: "Dot-notation path to field (e.g. 'user.age')" },
      operator: { type: "string", enum: ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "starts_with", "ends_with", "exists", "not_exists", "in", "regex"], description: "Comparison operator (default: eq)" },
      value: { type: "string", description: "Value to compare against" },
    },
    required: ["action", "data"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "where");
    let data: unknown[];
    try { data = JSON.parse(String(params.data || "[]")); } catch { return "Error: data must be valid JSON array"; }
    if (!Array.isArray(data)) return "Error: data must be an array";

    const path = String(params.path || "").trim();
    const op = String(params.operator || "eq");
    const val = params.value !== undefined ? String(params.value) : undefined;

    const predicate = (item: unknown): boolean => {
      const field_val = path ? this.get_path(item, path) : item;
      return this.compare(field_val, op, val);
    };

    switch (action) {
      case "where": return JSON.stringify(data.filter(predicate));
      case "find": return JSON.stringify(data.find(predicate) ?? null);
      case "reject": return JSON.stringify(data.filter((i) => !predicate(i)));
      case "every": return JSON.stringify({ result: data.every(predicate) });
      case "some": return JSON.stringify({ result: data.some(predicate) });
      case "count": return JSON.stringify({ count: data.filter(predicate).length, total: data.length });
      default: return `Error: unsupported action "${action}"`;
    }
  }

  private get_path(obj: unknown, path: string): unknown {
    let current: unknown = obj;
    for (const key of path.split(".")) {
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    return current;
  }

  private compare(field: unknown, op: string, value: string | undefined): boolean {
    if (op === "exists") return field !== undefined && field !== null;
    if (op === "not_exists") return field === undefined || field === null;

    const f = field == null ? "" : String(field);
    const v = value ?? "";
    const fn = Number(f), vn = Number(v);
    const both_num = f !== "" && v !== "" && !isNaN(fn) && !isNaN(vn);

    switch (op) {
      case "eq": return both_num ? fn === vn : f === v;
      case "neq": return both_num ? fn !== vn : f !== v;
      case "gt": return both_num ? fn > vn : f > v;
      case "gte": return both_num ? fn >= vn : f >= v;
      case "lt": return both_num ? fn < vn : f < v;
      case "lte": return both_num ? fn <= vn : f <= v;
      case "contains": return f.includes(v);
      case "starts_with": return f.startsWith(v);
      case "ends_with": return f.endsWith(v);
      case "in": { try { const arr = JSON.parse(v); return Array.isArray(arr) && arr.includes(field); } catch { return v.split(",").includes(f); } }
      case "regex": { try { return new RegExp(v).test(f); } catch { return false; } }
      default: return f === v;
    }
  }
}
