/** Aggregate 도구 — 배열 집계 연산 (sum/avg/min/max/count/group_by/percentile). */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class AggregateTool extends Tool {
  readonly name = "aggregate";
  readonly category = "data" as const;
  readonly description = "Aggregate arrays: sum, avg, min, max, count, group_by, percentile, join, unique, flatten.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["sum", "avg", "min", "max", "count", "group_by", "percentile", "join", "unique", "flatten"], description: "Aggregation operation" },
      data: { type: "string", description: "JSON array string" },
      field: { type: "string", description: "Dot-notation field path for nested values" },
      percentile: { type: "number", description: "Percentile value 0-100 (for percentile action)" },
      separator: { type: "string", description: "Join separator (for join action, default: ',')" },
    },
    required: ["action", "data"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "count");
    let data: unknown[];
    try { data = JSON.parse(String(params.data || "[]")); } catch { return "Error: data must be valid JSON array"; }
    if (!Array.isArray(data)) return "Error: data must be an array";

    const field = String(params.field || "").trim();
    const values = field ? data.map((item) => this.get_path(item, field)) : data;
    const nums = values.map(Number).filter(Number.isFinite);

    switch (action) {
      case "sum":
        return JSON.stringify({ result: nums.reduce((a, b) => a + b, 0), count: nums.length });
      case "avg":
        return JSON.stringify({ result: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0, count: nums.length });
      case "min":
        return JSON.stringify({ result: nums.length ? Math.min(...nums) : null, count: nums.length });
      case "max":
        return JSON.stringify({ result: nums.length ? Math.max(...nums) : null, count: nums.length });
      case "count":
        return JSON.stringify({ result: data.length });
      case "group_by": {
        if (!field) return "Error: field is required for group_by";
        const groups: Record<string, unknown[]> = {};
        for (const item of data) {
          const key = String(this.get_path(item, field) ?? "null");
          (groups[key] ??= []).push(item);
        }
        return JSON.stringify({ result: groups, group_count: Object.keys(groups).length });
      }
      case "percentile": {
        const p = Math.max(0, Math.min(100, Number(params.percentile) || 50));
        if (nums.length === 0) return JSON.stringify({ result: null });
        const sorted = [...nums].sort((a, b) => a - b);
        const idx = (p / 100) * (sorted.length - 1);
        const lower = Math.floor(idx);
        const frac = idx - lower;
        const result = lower + 1 >= sorted.length
          ? sorted[lower]
          : sorted[lower]! * (1 - frac) + sorted[lower + 1]! * frac;
        return JSON.stringify({ result, percentile: p, count: nums.length });
      }
      case "join": {
        const sep = String(params.separator ?? ",");
        return JSON.stringify({ result: values.map(String).join(sep), count: values.length });
      }
      case "unique":
        return JSON.stringify({ result: [...new Set(values.map(String))], count: new Set(values.map(String)).size });
      case "flatten":
        return JSON.stringify({ result: data.flat(), count: data.flat().length });
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private get_path(obj: unknown, path: string): unknown {
    let current: unknown = obj;
    for (const key of path.split(".")) {
      if (current === null || current === undefined || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    return current;
  }
}
