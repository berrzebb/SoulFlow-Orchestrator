/** Table 도구 — 배열-of-객체 정렬, 필터, group_by, join, pivot, aggregate. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

const MAX_ROWS = 50_000;

export class TableTool extends Tool {
  readonly name = "table";
  readonly category = "memory" as const;
  readonly description =
    "Tabular data operations on JSON arrays: sort, filter, group_by, join, pivot, aggregate, distinct, slice, pluck, count_by.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: { type: "string", enum: ["sort", "filter", "group_by", "join", "pivot", "aggregate", "distinct", "slice", "pluck", "count_by"], description: "Table operation" },
      data: { type: "string", description: "JSON array of objects" },
      data2: { type: "string", description: "Second JSON array (for join)" },
      field: { type: "string", description: "Field name to operate on" },
      fields: { type: "string", description: "Comma-separated field names (for pluck)" },
      order: { type: "string", enum: ["asc", "desc"], description: "Sort order (default: asc)" },
      condition: { type: "string", description: "JS filter expression using `row` variable" },
      join_field: { type: "string", description: "Join key field name" },
      join_type: { type: "string", enum: ["inner", "left", "right", "full"], description: "Join type (default: inner)" },
      agg: { type: "string", enum: ["sum", "avg", "min", "max", "count"], description: "Aggregation function" },
      value_field: { type: "string", description: "Value field for pivot/aggregate" },
      start: { type: "integer", description: "Slice start index" },
      end: { type: "integer", description: "Slice end index" },
    },
    required: ["operation", "data"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const op = String(params.operation || "sort");
    const data = this.parse_array(String(params.data || "[]"));
    if (!data) return "Error: invalid JSON array";
    if (data.length > MAX_ROWS) return `Error: data exceeds ${MAX_ROWS} rows`;

    switch (op) {
      case "sort": return this.sort(data, String(params.field || ""), String(params.order || "asc"));
      case "filter": return this.filter(data, String(params.condition || "true"));
      case "group_by": return this.group_by(data, String(params.field || ""));
      case "join": {
        const data2 = this.parse_array(String(params.data2 || "[]"));
        if (!data2) return "Error: invalid data2 JSON array";
        return this.join(data, data2, String(params.join_field || "id"), String(params.join_type || "inner"));
      }
      case "pivot": return this.pivot(data, String(params.field || ""), String(params.value_field || "value"), String(params.agg || "sum"));
      case "aggregate": return this.aggregate(data, String(params.field || ""), String(params.agg || "count"));
      case "distinct": return JSON.stringify(this.distinct(data, String(params.field || "")));
      case "slice": return JSON.stringify(data.slice(Number(params.start ?? 0), Number(params.end ?? data.length)));
      case "pluck": return JSON.stringify(this.pluck(data, String(params.fields || params.field || "")));
      case "count_by": return JSON.stringify(this.count_by(data, String(params.field || "")), null, 2);
      default: return `Error: unsupported operation "${op}"`;
    }
  }

  private parse_array(input: string): Record<string, unknown>[] | null {
    try {
      const parsed = JSON.parse(input);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private sort(data: Record<string, unknown>[], field: string, order: string): string {
    if (!field) return "Error: field is required for sort";
    const dir = order === "desc" ? -1 : 1;
    const sorted = [...data].sort((a, b) => {
      const av = a[field], bv = b[field];
      if ((av === null || av === undefined) && (bv === null || bv === undefined)) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return JSON.stringify(sorted);
  }

  private filter(data: Record<string, unknown>[], condition: string): string {
    try {
      const fn = new Function("row", `"use strict"; return (${condition});`);
      return JSON.stringify(data.filter((row) => fn(row)));
    } catch (e) {
      return `Error: invalid condition — ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private group_by(data: Record<string, unknown>[], field: string): string {
    if (!field) return "Error: field is required for group_by";
    const groups: Record<string, Record<string, unknown>[]> = {};
    for (const row of data) {
      const key = String(row[field] ?? "null");
      (groups[key] ??= []).push(row);
    }
    return JSON.stringify(groups, null, 2);
  }

  private join(a: Record<string, unknown>[], b: Record<string, unknown>[], key: string, type: string): string {
    const b_map = new Map<string, Record<string, unknown>[]>();
    for (const row of b) {
      const k = String(row[key] ?? "");
      (b_map.get(k) ?? (b_map.set(k, []), b_map.get(k)!)).push(row);
    }

    const results: Record<string, unknown>[] = [];
    const used_b = new Set<string>();

    for (const ra of a) {
      const k = String(ra[key] ?? "");
      const matches = b_map.get(k);
      if (matches) {
        used_b.add(k);
        for (const rb of matches) results.push({ ...ra, ...rb });
      } else if (type === "left" || type === "full") {
        results.push({ ...ra });
      }
    }

    if (type === "right" || type === "full") {
      for (const rb of b) {
        const k = String(rb[key] ?? "");
        if (!used_b.has(k)) results.push({ ...rb });
      }
    }

    return JSON.stringify(results);
  }

  private pivot(data: Record<string, unknown>[], row_field: string, value_field: string, agg: string): string {
    if (!row_field) return "Error: field is required for pivot";
    const groups: Record<string, number[]> = {};
    for (const row of data) {
      const key = String(row[row_field] ?? "null");
      const val = Number(row[value_field] ?? 0);
      (groups[key] ??= []).push(val);
    }
    const result: Record<string, number> = {};
    for (const [key, vals] of Object.entries(groups)) {
      result[key] = this.calc_agg(vals, agg);
    }
    return JSON.stringify(result, null, 2);
  }

  private aggregate(data: Record<string, unknown>[], field: string, agg: string): string {
    const values = data.map((r) => Number(r[field] ?? 0)).filter((n) => !isNaN(n));
    return JSON.stringify({ field, agg, value: this.calc_agg(values, agg), count: values.length });
  }

  private calc_agg(vals: number[], agg: string): number {
    if (vals.length === 0) return 0;
    switch (agg) {
      case "sum": return vals.reduce((a, b) => a + b, 0);
      case "avg": return vals.reduce((a, b) => a + b, 0) / vals.length;
      case "min": return Math.min(...vals);
      case "max": return Math.max(...vals);
      case "count": return vals.length;
      default: return vals.length;
    }
  }

  private distinct(data: Record<string, unknown>[], field: string): unknown[] {
    if (!field) {
      const seen = new Set<string>();
      return data.filter((r) => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; });
    }
    return [...new Set(data.map((r) => r[field]))];
  }

  private pluck(data: Record<string, unknown>[], fields_str: string): unknown[] {
    const fields = fields_str.split(",").map((f) => f.trim()).filter(Boolean);
    if (fields.length === 0) return data;
    if (fields.length === 1) return data.map((r) => r[fields[0]]);
    return data.map((r) => {
      const out: Record<string, unknown> = {};
      for (const f of fields) out[f] = r[f];
      return out;
    });
  }

  private count_by(data: Record<string, unknown>[], field: string): Record<string, number> {
    if (!field) return { total: data.length };
    const counts: Record<string, number> = {};
    for (const row of data) {
      const key = String(row[field] ?? "null");
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }
}
