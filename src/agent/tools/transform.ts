/** Transform 도구 — 데이터 구조 변환 (map/pick/omit/flatten/group_by/sort_by/unique/zip). */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class TransformTool extends Tool {
  readonly name = "transform";
  readonly category = "data" as const;
  readonly description = "Transform data structures. Actions: map, pick, omit, flatten, unflatten, group_by, sort_by, unique, zip, chunk, reverse.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["map", "pick", "omit", "flatten", "unflatten", "group_by", "sort_by", "unique", "zip", "chunk", "reverse"], description: "Transform operation" },
      data: { type: "string", description: "JSON data string (array or object)" },
      keys: { type: "string", description: "Comma-separated field names (pick/omit)" },
      path: { type: "string", description: "Dot-notation path (group_by/sort_by/map/unique)" },
      expression: { type: "string", description: "JS-like expression for map (e.g. 'item.name.toUpperCase()')" },
      order: { type: "string", enum: ["asc", "desc"], description: "Sort order (default: asc)" },
      size: { type: "integer", description: "Chunk size" },
      other: { type: "string", description: "Second JSON array for zip" },
    },
    required: ["action", "data"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "");
    let data: unknown;
    try { data = JSON.parse(String(params.data || "null")); } catch { return "Error: data must be valid JSON"; }

    switch (action) {
      case "pick": return this.pick_omit(data, params, true);
      case "omit": return this.pick_omit(data, params, false);
      case "flatten": return JSON.stringify(this.flatten_arr(data));
      case "unflatten": return JSON.stringify(this.unflatten_obj(data));
      case "group_by": return this.group_by(data, String(params.path || ""));
      case "sort_by": return this.sort_by(data, String(params.path || ""), String(params.order || "asc"));
      case "unique": return this.unique(data, String(params.path || ""));
      case "zip": return this.zip(data, String(params.other || "[]"));
      case "chunk": return this.chunk(data, Number(params.size || 10));
      case "reverse": return Array.isArray(data) ? JSON.stringify([...data].reverse()) : "Error: data must be an array";
      case "map": return this.map_items(data, String(params.path || ""), String(params.expression || ""));
      default: return `Error: unsupported action "${action}"`;
    }
  }

  private pick_omit(data: unknown, params: Record<string, unknown>, is_pick: boolean): string {
    const keys = new Set(String(params.keys || "").split(",").map((k) => k.trim()).filter(Boolean));
    if (keys.size === 0) return "Error: keys is required";
    const transform = (obj: unknown): unknown => {
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (is_pick ? keys.has(k) : !keys.has(k)) out[k] = v;
      }
      return out;
    };
    if (Array.isArray(data)) return JSON.stringify(data.map(transform));
    return JSON.stringify(transform(data));
  }

  private flatten_arr(data: unknown, depth = 10): unknown[] {
    if (!Array.isArray(data)) return [data];
    return data.flat(depth);
  }

  private unflatten_obj(data: unknown): unknown {
    if (!data || typeof data !== "object" || Array.isArray(data)) return data;
    const result: Record<string, unknown> = {};
    for (const [flat_key, value] of Object.entries(data as Record<string, unknown>)) {
      const parts = flat_key.split(".");
      let cur = result;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i]!;
        if (!(p in cur) || typeof cur[p] !== "object") cur[p] = {};
        cur = cur[p] as Record<string, unknown>;
      }
      cur[parts[parts.length - 1]!] = value;
    }
    return result;
  }

  private group_by(data: unknown, path: string): string {
    if (!Array.isArray(data)) return "Error: data must be an array";
    if (!path) return "Error: path is required";
    const groups: Record<string, unknown[]> = {};
    for (const item of data) {
      const key = String(this.get_path(item, path) ?? "null");
      (groups[key] ??= []).push(item);
    }
    return JSON.stringify(groups);
  }

  private sort_by(data: unknown, path: string, order: string): string {
    if (!Array.isArray(data)) return "Error: data must be an array";
    if (!path) return "Error: path is required";
    const sorted = [...data].sort((a, b) => {
      const va = this.get_path(a, path), vb = this.get_path(b, path);
      const na = Number(va), nb = Number(vb);
      const cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : String(va ?? "").localeCompare(String(vb ?? ""));
      return order === "desc" ? -cmp : cmp;
    });
    return JSON.stringify(sorted);
  }

  private unique(data: unknown, path: string): string {
    if (!Array.isArray(data)) return "Error: data must be an array";
    if (!path) return JSON.stringify([...new Set(data.map((i) => JSON.stringify(i)))].map((s) => JSON.parse(s)));
    const seen = new Set<string>();
    return JSON.stringify(data.filter((item) => {
      const key = JSON.stringify(this.get_path(item, path));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }));
  }

  private zip(data: unknown, other_str: string): string {
    if (!Array.isArray(data)) return "Error: data must be an array";
    let other: unknown[];
    try { other = JSON.parse(other_str); } catch { return "Error: other must be valid JSON array"; }
    if (!Array.isArray(other)) return "Error: other must be an array";
    const len = Math.max(data.length, other.length);
    const result = Array.from({ length: len }, (_, i) => [data[i] ?? null, other[i] ?? null]);
    return JSON.stringify(result);
  }

  private chunk(data: unknown, size: number): string {
    if (!Array.isArray(data)) return "Error: data must be an array";
    if (size < 1) return "Error: size must be >= 1";
    const chunks: unknown[][] = [];
    for (let i = 0; i < data.length; i += size) chunks.push(data.slice(i, i + size));
    return JSON.stringify(chunks);
  }

  private map_items(data: unknown, path: string, _expr: string): string {
    if (!Array.isArray(data)) return "Error: data must be an array";
    if (!path) return "Error: path is required for map (extracts field from each item)";
    return JSON.stringify(data.map((item) => this.get_path(item, path)));
  }

  private get_path(obj: unknown, path: string): unknown {
    let cur: unknown = obj;
    for (const key of path.split(".")) {
      if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[key];
    }
    return cur;
  }
}
