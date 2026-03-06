/** DataFormat 도구 — JSON/CSV/YAML/TOML 변환 + jq-style 쿼리 + 스키마 검증. */

import { Tool } from "./base.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";
import { error_message } from "../../utils/common.js";

type FormatType = "json" | "csv" | "yaml" | "toml";

export class DataFormatTool extends Tool {
  readonly name = "data_format";
  readonly category = "memory" as const;
  readonly description =
    "Convert between data formats (JSON, CSV, YAML, TOML), query with JSONPath, validate, flatten/unflatten, and pretty-print.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["convert", "query", "validate", "pretty", "flatten", "unflatten", "merge", "pick", "omit"],
        description: "Operation to perform",
      },
      input: { type: "string", description: "Input data as string" },
      from: { type: "string", enum: ["json", "csv", "yaml", "toml"], description: "Input format (for convert)" },
      to: { type: "string", enum: ["json", "csv", "yaml", "toml"], description: "Output format (for convert)" },
      path: { type: "string", description: "JSONPath expression (for query, e.g. $.users[0].name)" },
      keys: { type: "string", description: "Comma-separated keys (for pick/omit)" },
      input2: { type: "string", description: "Second input (for merge)" },
      delimiter: { type: "string", description: "CSV delimiter (default ',')" },
    },
    required: ["operation", "input"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const op = String(params.operation || "pretty");
    const input = String(params.input || "");
    if (!input.trim()) return "Error: input is required";

    try {
      switch (op) {
        case "convert": return this.convert(input, params);
        case "query": return this.query(input, String(params.path || "$"));
        case "validate": return this.validate(input);
        case "pretty": return this.pretty(input);
        case "flatten": return this.flatten(input);
        case "unflatten": return this.unflatten(input);
        case "merge": return this.merge(input, String(params.input2 || "{}"));
        case "pick": return this.pick_omit(input, String(params.keys || ""), true);
        case "omit": return this.pick_omit(input, String(params.keys || ""), false);
        default: return `Error: unsupported operation "${op}"`;
      }
    } catch (err) {
      return `Error: ${error_message(err)}`;
    }
  }

  private convert(input: string, params: Record<string, unknown>): string {
    const from = String(params.from || "json") as FormatType;
    const to = String(params.to || "json") as FormatType;
    const delim = String(params.delimiter || ",");
    const data = this.parse(input, from, delim);
    return this.serialize(data, to, delim);
  }

  private query(input: string, path: string): string {
    const data = JSON.parse(input);
    const result = this.jsonpath(data, path);
    return JSON.stringify(result, null, 2);
  }

  private validate(input: string): string {
    try {
      const parsed = JSON.parse(input);
      const type = Array.isArray(parsed) ? "array" : typeof parsed;
      const size = Array.isArray(parsed) ? parsed.length : typeof parsed === "object" && parsed ? Object.keys(parsed).length : 1;
      return JSON.stringify({ valid: true, type, size }, null, 2);
    } catch (err) {
      return JSON.stringify({ valid: false, error: error_message(err) }, null, 2);
    }
  }

  private pretty(input: string): string {
    return JSON.stringify(JSON.parse(input), null, 2);
  }

  private flatten(input: string): string {
    const data = JSON.parse(input);
    const result: Record<string, unknown> = {};
    const walk = (obj: unknown, prefix: string) => {
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          walk(v, prefix ? `${prefix}.${k}` : k);
        }
      } else if (Array.isArray(obj)) {
        obj.forEach((v, i) => walk(v, `${prefix}[${i}]`));
      } else {
        result[prefix] = obj;
      }
    };
    walk(data, "");
    return JSON.stringify(result, null, 2);
  }

  private unflatten(input: string): string {
    const flat = JSON.parse(input) as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(flat)) {
      const parts = key.replace(/\[(\d+)\]/g, ".$1").split(".");
      let curr: Record<string, unknown> = result;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        const next_is_num = /^\d+$/.test(parts[i + 1]);
        if (!(p in curr)) curr[p] = next_is_num ? [] : {};
        curr = curr[p] as Record<string, unknown>;
      }
      curr[parts[parts.length - 1]] = val;
    }
    return JSON.stringify(result, null, 2);
  }

  private merge(input1: string, input2: string): string {
    const a = JSON.parse(input1);
    const b = JSON.parse(input2);
    if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify([...a, ...b], null, 2);
    if (typeof a === "object" && typeof b === "object") return JSON.stringify({ ...a, ...b }, null, 2);
    return JSON.stringify([a, b], null, 2);
  }

  private pick_omit(input: string, keys_str: string, is_pick: boolean): string {
    const data = JSON.parse(input);
    if (typeof data !== "object" || Array.isArray(data) || !data) return "Error: input must be an object";
    const keys = new Set(keys_str.split(",").map((k) => k.trim()).filter(Boolean));
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (is_pick ? keys.has(k) : !keys.has(k)) result[k] = v;
    }
    return JSON.stringify(result, null, 2);
  }

  /* ── 포맷 파서/시리얼라이저 ── */

  private parse(input: string, format: FormatType, delim: string): unknown {
    switch (format) {
      case "json": return JSON.parse(input);
      case "csv": return this.csv_to_json(input, delim);
      case "yaml": return this.yaml_parse(input);
      case "toml": return this.toml_parse(input);
      default: return JSON.parse(input);
    }
  }

  private serialize(data: unknown, format: FormatType, delim: string): string {
    switch (format) {
      case "json": return JSON.stringify(data, null, 2);
      case "csv": return this.json_to_csv(data, delim);
      case "yaml": return this.yaml_serialize(data);
      case "toml": return this.toml_serialize(data);
      default: return JSON.stringify(data, null, 2);
    }
  }

  /* ── CSV ── */

  private csv_to_json(csv: string, delim: string): unknown[] {
    const lines = csv.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return [];
    const headers = this.parse_csv_line(lines[0], delim);
    return lines.slice(1).map((line) => {
      const cells = this.parse_csv_line(line, delim);
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = cells[i] ?? ""; });
      return obj;
    });
  }

  private parse_csv_line(line: string, delim: string): string[] {
    const result: string[] = [];
    let current = "";
    let in_quote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (in_quote) {
        if (ch === '"') {
          if (line[i + 1] === '"') { current += '"'; i++; }
          else in_quote = false;
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        in_quote = true;
      } else if (ch === delim) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  private json_to_csv(data: unknown, delim: string): string {
    if (!Array.isArray(data)) data = [data];
    const arr = data as Record<string, unknown>[];
    if (arr.length === 0) return "";
    const keys = [...new Set(arr.flatMap((r) => (r && typeof r === "object" ? Object.keys(r) : [])))];
    const escape = (v: unknown): string => {
      const s = v == null ? "" : String(v);
      return s.includes(delim) || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = keys.map(escape).join(delim);
    const rows = arr.map((r) => keys.map((k) => escape((r as Record<string, unknown>)[k])).join(delim));
    return [header, ...rows].join("\n");
  }

  /* ── YAML (경량 구현) ── */

  private yaml_parse(input: string): unknown {
    const lines = input.split(/\r?\n/);
    return this.yaml_parse_block(lines, 0, 0).value;
  }

  private yaml_parse_block(lines: string[], start: number, indent: number): { value: unknown; end: number } {
    const result: Record<string, unknown> = {};
    let i = start;
    let is_list = false;
    const list_items: unknown[] = [];

    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim() || line.trim().startsWith("#")) { i++; continue; }
      const line_indent = line.search(/\S/);
      if (line_indent < indent) break;
      if (line_indent > indent && i > start) break;

      const trimmed = line.trim();

      if (trimmed.startsWith("- ")) {
        is_list = true;
        list_items.push(this.yaml_parse_value(trimmed.slice(2).trim()));
        i++;
        continue;
      }

      const colon_idx = trimmed.indexOf(":");
      if (colon_idx > 0) {
        const key = trimmed.slice(0, colon_idx).trim();
        const after = trimmed.slice(colon_idx + 1).trim();
        if (after) {
          result[key] = this.yaml_parse_value(after);
          i++;
        } else {
          const nested = this.yaml_parse_block(lines, i + 1, line_indent + 2);
          result[key] = nested.value;
          i = nested.end;
        }
        continue;
      }

      i++;
    }

    return { value: is_list ? list_items : result, end: i };
  }

  private yaml_parse_value(s: string): unknown {
    if (s === "true" || s === "yes") return true;
    if (s === "false" || s === "no") return false;
    if (s === "null" || s === "~") return null;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
    if (s.startsWith("[")) { try { return JSON.parse(s); } catch { /* fall through */ } }
    if (s.startsWith("{")) { try { return JSON.parse(s); } catch { /* fall through */ } }
    return s;
  }

  private yaml_serialize(data: unknown, indent = 0): string {
    const pad = "  ".repeat(indent);
    if (data === null || data === undefined) return `${pad}null\n`;
    if (typeof data === "boolean" || typeof data === "number") return `${pad}${data}\n`;
    if (typeof data === "string") return `${pad}${data.includes(":") || data.includes("#") ? `"${data}"` : data}\n`;
    if (Array.isArray(data)) {
      if (data.length === 0) return `${pad}[]\n`;
      return data.map((item) => {
        if (typeof item === "object" && item !== null) {
          const inner = this.yaml_serialize(item, indent + 1).trimStart();
          return `${pad}- ${inner}`;
        }
        return `${pad}- ${item}\n`;
      }).join("");
    }
    if (typeof data === "object") {
      const entries = Object.entries(data as Record<string, unknown>);
      if (entries.length === 0) return `${pad}{}\n`;
      return entries.map(([k, v]) => {
        if (typeof v === "object" && v !== null) {
          return `${pad}${k}:\n${this.yaml_serialize(v, indent + 1)}`;
        }
        return `${pad}${k}: ${String(v)}\n`;
      }).join("");
    }
    return `${pad}${String(data)}\n`;
  }

  /* ── TOML (경량 구현) ── */

  private toml_parse(input: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    let current_section = result;
    for (const raw_line of input.split(/\r?\n/)) {
      const line = raw_line.trim();
      if (!line || line.startsWith("#")) continue;
      const section_match = line.match(/^\[([^\]]+)\]$/);
      if (section_match) {
        const key = section_match[1].trim();
        if (!(key in result)) (result as Record<string, unknown>)[key] = {};
        current_section = (result as Record<string, unknown>)[key] as Record<string, unknown>;
        continue;
      }
      const eq_idx = line.indexOf("=");
      if (eq_idx > 0) {
        const k = line.slice(0, eq_idx).trim();
        const v = line.slice(eq_idx + 1).trim();
        current_section[k] = this.yaml_parse_value(v);
      }
    }
    return result;
  }

  private toml_serialize(data: unknown, section = ""): string {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return JSON.stringify(data);
    }
    const lines: string[] = [];
    const nested: [string, unknown][] = [];
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        nested.push([k, v]);
      } else {
        const val = typeof v === "string" ? `"${v}"` : String(v);
        lines.push(`${k} = ${val}`);
      }
    }
    for (const [k, v] of nested) {
      const full_key = section ? `${section}.${k}` : k;
      lines.push("", `[${full_key}]`, this.toml_serialize(v, full_key));
    }
    return lines.join("\n");
  }

  /* ── JSONPath (경량 구현) ── */

  private jsonpath(data: unknown, path: string): unknown {
    if (path === "$" || path === ".") return data;
    const normalized = path.replace(/^\$\.?/, "");
    const segments = this.parse_jsonpath_segments(normalized);
    let current: unknown = data;

    for (const seg of segments) {
      if (current === null || current === undefined) return null;

      if (seg === "*") {
        if (Array.isArray(current)) return current;
        if (typeof current === "object") return Object.values(current as Record<string, unknown>);
        return null;
      }

      const array_match = seg.match(/^(\w+)\[(\d+)\]$/);
      if (array_match) {
        const obj = (current as Record<string, unknown>)[array_match[1]];
        if (Array.isArray(obj)) current = obj[parseInt(array_match[2], 10)];
        else return null;
        continue;
      }

      const index_match = seg.match(/^\[(\d+)\]$/);
      if (index_match) {
        if (Array.isArray(current)) current = current[parseInt(index_match[1], 10)];
        else return null;
        continue;
      }

      if (typeof current === "object" && current !== null) {
        current = (current as Record<string, unknown>)[seg];
      } else {
        return null;
      }
    }

    return current;
  }

  private parse_jsonpath_segments(path: string): string[] {
    const segments: string[] = [];
    let current = "";
    for (let i = 0; i < path.length; i++) {
      const ch = path[i];
      if (ch === ".") {
        if (current) segments.push(current);
        current = "";
      } else if (ch === "[") {
        if (current) { current += ch; }
        else { current = ch; }
      } else if (ch === "]") {
        current += ch;
        segments.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    if (current) segments.push(current);
    return segments;
  }
}
