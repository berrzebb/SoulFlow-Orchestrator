/** YAML 도구 — YAML 파싱/생성/머지/검증. 순수 JS 경량 구현. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class YamlTool extends Tool {
  readonly name = "yaml";
  readonly category = "data" as const;
  readonly description = "YAML operations: parse (YAML to JSON), generate (JSON to YAML), merge, validate, query.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["parse", "generate", "merge", "validate", "query"], description: "YAML operation" },
      data: { type: "string", description: "YAML string (parse/validate/query) or JSON string (generate)" },
      data2: { type: "string", description: "Second YAML string (merge)" },
      path: { type: "string", description: "Dot-notation path (query)" },
      indent: { type: "integer", description: "Indentation spaces (generate, default: 2)" },
    },
    required: ["action", "data"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "parse");
    const data = String(params.data || "");

    switch (action) {
      case "parse": return this.parse_yaml(data);
      case "generate": return this.generate_yaml(data, Number(params.indent) || 2);
      case "merge": return this.merge_yaml(data, String(params.data2 || ""));
      case "validate": return this.validate_yaml(data);
      case "query": return this.query_yaml(data, String(params.path || ""));
      default: return `Error: unsupported action "${action}"`;
    }
  }

  private parse_yaml(yaml: string): string {
    try {
      const result = this.yaml_parse(yaml);
      return JSON.stringify(result);
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }
  }

  private generate_yaml(json_str: string, indent: number): string {
    try {
      const obj = JSON.parse(json_str);
      return this.to_yaml(obj, 0, indent);
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }
  }

  private merge_yaml(yaml1: string, yaml2: string): string {
    try {
      const a = this.yaml_parse(yaml1);
      const b = this.yaml_parse(yaml2);
      if (typeof a !== "object" || typeof b !== "object" || Array.isArray(a) || Array.isArray(b)) {
        return "Error: both inputs must be YAML objects for merge";
      }
      const merged = this.deep_merge(a as Record<string, unknown>, b as Record<string, unknown>);
      return this.to_yaml(merged, 0, 2);
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }
  }

  private validate_yaml(yaml: string): string {
    try {
      this.yaml_parse(yaml);
      return JSON.stringify({ valid: true });
    } catch (err) {
      return JSON.stringify({ valid: false, error: (err as Error).message });
    }
  }

  private query_yaml(yaml: string, path: string): string {
    if (!path) return "Error: path is required for query";
    try {
      const parsed = this.yaml_parse(yaml);
      let current: unknown = parsed;
      for (const part of path.split(".")) {
        if (current && typeof current === "object") {
          current = (current as Record<string, unknown>)[part];
        } else {
          return JSON.stringify({ result: null, path });
        }
      }
      return JSON.stringify({ result: current, path });
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }
  }

  /** 경량 YAML 파서 — 기본적인 매핑/시퀀스/스칼라 지원. */
  private yaml_parse(yaml: string): unknown {
    const lines = yaml.split("\n");
    const cleaned = lines.filter((l) => !l.trimStart().startsWith("#") && l.trim() !== "---" && l.trim() !== "...");
    return this.parse_block(cleaned, 0).value;
  }

  private parse_block(lines: string[], start_indent: number): { value: unknown; consumed: number } {
    if (lines.length === 0) return { value: null, consumed: 0 };

    const first = lines[0]!;
    const trimmed = first.trimStart();

    if (trimmed.startsWith("- ")) {
      return this.parse_sequence(lines, start_indent);
    }

    if (trimmed.includes(": ") || trimmed.endsWith(":")) {
      return this.parse_mapping(lines, start_indent);
    }

    return { value: this.parse_scalar(trimmed), consumed: 1 };
  }

  private parse_mapping(lines: string[], base_indent: number): { value: Record<string, unknown>; consumed: number } {
    const result: Record<string, unknown> = {};
    let i = 0;

    while (i < lines.length) {
      const line = lines[i]!;
      const indent = line.length - line.trimStart().length;
      if (i > 0 && indent < base_indent) break;

      const trimmed = line.trimStart();
      if (!trimmed || trimmed.startsWith("#")) { i++; continue; }

      const colon_idx = trimmed.indexOf(": ");
      const ends_colon = trimmed.endsWith(":");

      if (colon_idx >= 0) {
        const key = trimmed.slice(0, colon_idx).trim().replace(/^['"]|['"]$/g, "");
        const val_str = trimmed.slice(colon_idx + 2).trim();
        if (val_str) {
          result[key] = this.parse_scalar(val_str);
          i++;
        } else {
          i++;
          const child_lines = this.collect_block(lines, i, indent + 2);
          const child = this.parse_block(child_lines, indent + 2);
          result[key] = child.value;
          i += child.consumed;
        }
      } else if (ends_colon) {
        const key = trimmed.slice(0, -1).trim().replace(/^['"]|['"]$/g, "");
        i++;
        const child_lines = this.collect_block(lines, i, indent + 2);
        const child = this.parse_block(child_lines, indent + 2);
        result[key] = child.value;
        i += child.consumed;
      } else {
        i++;
      }
    }

    return { value: result, consumed: i };
  }

  private parse_sequence(lines: string[], base_indent: number): { value: unknown[]; consumed: number } {
    const result: unknown[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i]!;
      const indent = line.length - line.trimStart().length;
      if (i > 0 && indent < base_indent) break;

      const trimmed = line.trimStart();
      if (!trimmed || trimmed.startsWith("#")) { i++; continue; }

      if (trimmed.startsWith("- ")) {
        const val = trimmed.slice(2).trim();
        if (val.includes(": ") || val.endsWith(":")) {
          const sub_lines = [" ".repeat(indent + 2) + val, ...this.collect_block(lines, i + 1, indent + 2)];
          const child = this.parse_block(sub_lines, indent + 2);
          result.push(child.value);
          i += 1 + (child.consumed > 0 ? this.collect_block(lines, i + 1, indent + 2).length : 0);
        } else {
          result.push(this.parse_scalar(val));
          i++;
        }
      } else {
        break;
      }
    }

    return { value: result, consumed: i };
  }

  private collect_block(lines: string[], start: number, min_indent: number): string[] {
    const block: string[] = [];
    for (let i = start; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.trim() === "" || line.trim().startsWith("#")) { block.push(line); continue; }
      const indent = line.length - line.trimStart().length;
      if (indent < min_indent) break;
      block.push(line);
    }
    return block;
  }

  private parse_scalar(s: string): unknown {
    if (s === "null" || s === "~") return null;
    if (s === "true" || s === "True" || s === "TRUE") return true;
    if (s === "false" || s === "False" || s === "FALSE") return false;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) return s.slice(1, -1);
    if (s.startsWith("[") && s.endsWith("]")) {
      try { return JSON.parse(s); } catch { /* continue */ }
    }
    if (s.startsWith("{") && s.endsWith("}")) {
      try { return JSON.parse(s); } catch { /* continue */ }
    }
    return s;
  }

  private to_yaml(val: unknown, indent: number, spaces: number): string {
    const pad = " ".repeat(indent);
    if (val === null || val === undefined) return `${pad}null`;
    if (typeof val === "boolean" || typeof val === "number") return `${pad}${val}`;
    if (typeof val === "string") {
      if (val.includes("\n")) return `${pad}|\n${val.split("\n").map((l) => " ".repeat(indent + spaces) + l).join("\n")}`;
      if (val === "" || /[:{},&*#?|>!%@`]/.test(val) || val.includes("[") || val.includes("]")) return `${pad}"${val.replace(/"/g, '\\"')}"`;
      return `${pad}${val}`;
    }
    if (Array.isArray(val)) {
      if (val.length === 0) return `${pad}[]`;
      return val.map((item) => {
        if (typeof item === "object" && item !== null) {
          const inner = this.to_yaml(item, indent + spaces, spaces).trimStart();
          return `${pad}- ${inner}`;
        }
        return `${pad}- ${this.to_yaml(item, 0, spaces).trim()}`;
      }).join("\n");
    }
    if (typeof val === "object") {
      const entries = Object.entries(val);
      if (entries.length === 0) return `${pad}{}`;
      return entries.map(([k, v]) => {
        if (v === null || typeof v !== "object") {
          return `${pad}${k}: ${this.to_yaml(v, 0, spaces).trim()}`;
        }
        return `${pad}${k}:\n${this.to_yaml(v, indent + spaces, spaces)}`;
      }).join("\n");
    }
    return `${pad}${String(val)}`;
  }

  private deep_merge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
    const result = { ...a };
    for (const [key, val] of Object.entries(b)) {
      if (val && typeof val === "object" && !Array.isArray(val) && result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
        result[key] = this.deep_merge(result[key] as Record<string, unknown>, val as Record<string, unknown>);
      } else {
        result[key] = val;
      }
    }
    return result;
  }
}
