/** INI 도구 — INI/conf 파일 파싱/생성/검증/쿼리/머지. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";
import { error_message } from "../../utils/common.js";

export class IniTool extends Tool {
  readonly name = "ini";
  readonly category = "data" as const;
  readonly description = "INI file utilities: parse, generate, validate, query, merge.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["parse", "generate", "validate", "query", "merge"], description: "INI operation" },
      input: { type: "string", description: "INI string" },
      data: { type: "string", description: "JSON object for generate" },
      section: { type: "string", description: "Section name for query" },
      key: { type: "string", description: "Key name for query" },
      second: { type: "string", description: "Second INI string for merge" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "parse");

    switch (action) {
      case "parse": {
        const input = String(params.input || "");
        const result = this.parse_ini(input);
        return JSON.stringify({ result, sections: Object.keys(result) });
      }
      case "generate": {
        let data: Record<string, Record<string, unknown> | unknown>;
        try { data = JSON.parse(String(params.data || "{}")); } catch { return "Error: data must be valid JSON"; }
        return this.generate_ini(data);
      }
      case "validate": {
        const input = String(params.input || "");
        try {
          this.parse_ini(input);
          return JSON.stringify({ valid: true });
        } catch (e) {
          return JSON.stringify({ valid: false, error: error_message(e) });
        }
      }
      case "query": {
        const input = String(params.input || "");
        const section = String(params.section || "");
        const key = params.key ? String(params.key) : null;
        const result = this.parse_ini(input);
        if (section && key) {
          const sec = result[section] as Record<string, unknown> | undefined;
          const value = sec?.[key];
          return JSON.stringify({ section, key, value: value ?? null, found: value !== undefined });
        }
        if (section) {
          const sec = result[section];
          return JSON.stringify({ section, values: sec || null, found: sec !== undefined });
        }
        return JSON.stringify({ sections: Object.keys(result), count: Object.keys(result).length });
      }
      case "merge": {
        const a = this.parse_ini(String(params.input || ""));
        const b = this.parse_ini(String(params.second || ""));
        const merged: Record<string, unknown> = { ...a };
        for (const [section, values] of Object.entries(b)) {
          if (typeof values === "object" && values !== null && typeof merged[section] === "object" && merged[section] !== null) {
            merged[section] = { ...(merged[section] as Record<string, unknown>), ...(values as Record<string, unknown>) };
          } else {
            merged[section] = values;
          }
        }
        return JSON.stringify({ result: merged });
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private parse_ini(input: string): Record<string, Record<string, string> | string> {
    const result: Record<string, Record<string, string> | string> = {};
    let current_section = "";

    for (const raw_line of input.split("\n")) {
      const line = raw_line.trim();
      if (!line || line.startsWith(";") || line.startsWith("#")) continue;

      const sec_match = line.match(/^\[([^\]]+)\]$/);
      if (sec_match) {
        current_section = sec_match[1]!.trim();
        if (!result[current_section]) result[current_section] = {};
        continue;
      }

      const eq_idx = line.indexOf("=");
      if (eq_idx === -1) continue;
      const key = line.slice(0, eq_idx).trim();
      let value = line.slice(eq_idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (current_section) {
        const sec = result[current_section];
        if (typeof sec === "object" && sec !== null) sec[key] = value;
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private generate_ini(data: Record<string, unknown>): string {
    const lines: string[] = [];
    const sections: [string, Record<string, unknown>][] = [];

    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        sections.push([key, value as Record<string, unknown>]);
      } else {
        lines.push(`${key} = ${this.format_value(value)}`);
      }
    }

    for (const [section, values] of sections) {
      lines.push("");
      lines.push(`[${section}]`);
      for (const [k, v] of Object.entries(values)) {
        lines.push(`${k} = ${this.format_value(v)}`);
      }
    }

    return lines.join("\n");
  }

  private format_value(value: unknown): string {
    if (typeof value === "string") {
      return value.includes(" ") || value.includes("=") || value.includes(";") ? `"${value}"` : value;
    }
    return String(value);
  }
}
