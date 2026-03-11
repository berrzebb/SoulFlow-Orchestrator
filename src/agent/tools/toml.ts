/** TOML 도구 — TOML 파싱/생성/검증/쿼리. */

import { deep_merge, error_message } from "../../utils/common.js";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class TomlTool extends Tool {
  readonly name = "toml";
  readonly category = "data" as const;
  readonly description = "TOML utilities: parse, generate, validate, query, merge.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["parse", "generate", "validate", "query", "merge"], description: "TOML operation" },
      input: { type: "string", description: "TOML string (parse/validate/query) or JSON string (generate)" },
      path: { type: "string", description: "Dot-path query (e.g. 'package.name')" },
      second: { type: "string", description: "Second TOML string for merge" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "parse");
    const input = String(params.input || "");

    switch (action) {
      case "parse": {
        try {
          const result = this.parse_toml(input);
          return JSON.stringify({ result });
        } catch (e) {
          return JSON.stringify({ error: error_message(e) });
        }
      }
      case "generate": {
        try {
          const obj = JSON.parse(input);
          return this.generate_toml(obj);
        } catch {
          return "Error: input must be valid JSON";
        }
      }
      case "validate": {
        try {
          this.parse_toml(input);
          return JSON.stringify({ valid: true });
        } catch (e) {
          return JSON.stringify({ valid: false, error: error_message(e) });
        }
      }
      case "query": {
        const path = String(params.path || "");
        if (!path) return "Error: path is required for query";
        try {
          const obj = this.parse_toml(input);
          const result = this.resolve_path(obj, path);
          return JSON.stringify({ path, value: result, found: result !== undefined });
        } catch (e) {
          return JSON.stringify({ error: error_message(e) });
        }
      }
      case "merge": {
        try {
          const a = this.parse_toml(input);
          const b = this.parse_toml(String(params.second || ""));
          const merged = deep_merge(a, b);
          return JSON.stringify({ result: merged });
        } catch (e) {
          return JSON.stringify({ error: error_message(e) });
        }
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private parse_toml(input: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    let current = result;
    const lines = input.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (!line || line.startsWith("#")) continue;

      const table_match = line.match(/^\[([^\]]+)\]$/);
      if (table_match) {
        const path = table_match[1]!.trim();
        current = result;
        for (const part of path.split(".")) {
          const key = part.trim().replace(/^["']|["']$/g, "");
          if (!(key in current) || typeof current[key] !== "object") {
            current[key] = {};
          }
          current = current[key] as Record<string, unknown>;
        }
        continue;
      }

      const array_table_match = line.match(/^\[\[([^\]]+)\]\]$/);
      if (array_table_match) {
        const path = array_table_match[1]!.trim();
        const parts = path.split(".").map((p) => p.trim().replace(/^["']|["']$/g, ""));
        let target: Record<string, unknown> = result;
        for (let j = 0; j < parts.length - 1; j++) {
          if (!(parts[j]! in target)) target[parts[j]!] = {};
          target = target[parts[j]!] as Record<string, unknown>;
        }
        const last = parts[parts.length - 1]!;
        if (!Array.isArray(target[last])) target[last] = [];
        const entry: Record<string, unknown> = {};
        (target[last] as unknown[]).push(entry);
        current = entry;
        continue;
      }

      const eq_idx = line.indexOf("=");
      if (eq_idx === -1) continue;
      const key = line.slice(0, eq_idx).trim().replace(/^["']|["']$/g, "");
      const val_str = line.slice(eq_idx + 1).trim();
      current[key] = this.parse_value(val_str);
    }
    return result;
  }

  private parse_value(val: string): unknown {
    if (val.startsWith('"') && val.endsWith('"')) return val.slice(1, -1).replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\\\/g, "\\").replace(/\\"/g, '"');
    if (val.startsWith("'") && val.endsWith("'")) return val.slice(1, -1);
    if (val === "true") return true;
    if (val === "false") return false;
    if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val;
    if (val.startsWith("[")) {
      try {
        return JSON.parse(val.replace(/'/g, '"'));
      } catch {
        return val;
      }
    }
    const num = Number(val);
    if (!isNaN(num) && val !== "") return num;
    return val;
  }

  private generate_toml(obj: Record<string, unknown>, prefix = ""): string {
    const lines: string[] = [];
    const tables: [string, Record<string, unknown>][] = [];

    for (const [key, value] of Object.entries(obj)) {
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        tables.push([prefix ? `${prefix}.${key}` : key, value as Record<string, unknown>]);
      } else {
        lines.push(`${key} = ${this.value_to_toml(value)}`);
      }
    }

    for (const [path, table] of tables) {
      lines.push("");
      lines.push(`[${path}]`);
      lines.push(this.generate_toml(table, path));
    }

    return lines.join("\n");
  }

  private value_to_toml(value: unknown): string {
    if (typeof value === "string") return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    if (typeof value === "boolean") return String(value);
    if (typeof value === "number") return String(value);
    if (Array.isArray(value)) return `[${value.map((v) => this.value_to_toml(v)).join(", ")}]`;
    return JSON.stringify(value);
  }

  private resolve_path(obj: unknown, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

}
