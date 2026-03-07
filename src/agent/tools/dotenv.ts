/** Dotenv 도구 — .env 파일 파싱/생성/머지/검증. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class DotenvTool extends Tool {
  readonly name = "dotenv";
  readonly category = "data" as const;
  readonly description = "Dotenv (.env) file utilities: parse, generate, merge, validate, diff.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["parse", "generate", "merge", "validate", "diff"], description: "Dotenv operation" },
      input: { type: "string", description: ".env file content" },
      data: { type: "string", description: "JSON object of key=value pairs (generate)" },
      second: { type: "string", description: "Second .env content (merge/diff)" },
      required_keys: { type: "string", description: "Comma-separated required key names (validate)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "parse");

    switch (action) {
      case "parse": {
        const input = String(params.input || "");
        const result = this.parse_dotenv(input);
        return JSON.stringify({ variables: result, count: Object.keys(result).length });
      }
      case "generate": {
        let data: Record<string, string>;
        try { data = JSON.parse(String(params.data || "{}")); } catch { return "Error: data must be valid JSON"; }
        const lines = Object.entries(data).map(([k, v]) => {
          const needs_quote = typeof v === "string" && (/\s|"|#|'/.test(v) || v.includes("$"));
          return `${k}=${needs_quote ? `"${v.replace(/"/g, '\\"')}"` : v}`;
        });
        return lines.join("\n");
      }
      case "merge": {
        const a = this.parse_dotenv(String(params.input || ""));
        const b = this.parse_dotenv(String(params.second || ""));
        const merged = { ...a, ...b };
        return JSON.stringify({ variables: merged, count: Object.keys(merged).length, from_first: Object.keys(a).length, from_second: Object.keys(b).length });
      }
      case "validate": {
        const vars = this.parse_dotenv(String(params.input || ""));
        const required = String(params.required_keys || "").split(",").map((k) => k.trim()).filter(Boolean);
        const missing = required.filter((k) => !(k in vars));
        const empty = required.filter((k) => k in vars && !vars[k]);
        return JSON.stringify({ valid: missing.length === 0, missing, empty, total_keys: Object.keys(vars).length });
      }
      case "diff": {
        const a = this.parse_dotenv(String(params.input || ""));
        const b = this.parse_dotenv(String(params.second || ""));
        const all_keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        const added: string[] = [];
        const removed: string[] = [];
        const changed: { key: string; old: string; new: string }[] = [];
        const unchanged: string[] = [];
        for (const key of all_keys) {
          if (!(key in a)) added.push(key);
          else if (!(key in b)) removed.push(key);
          else if (a[key] !== b[key]) changed.push({ key, old: a[key]!, new: b[key]! });
          else unchanged.push(key);
        }
        return JSON.stringify({ added, removed, changed, unchanged: unchanged.length });
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private parse_dotenv(input: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const raw_line of input.split("\n")) {
      const line = raw_line.trim();
      if (!line || line.startsWith("#")) continue;

      const eq_idx = line.indexOf("=");
      if (eq_idx === -1) continue;

      const key = line.slice(0, eq_idx).trim();
      let value = line.slice(eq_idx + 1).trim();

      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"');

      const comment_idx = value.indexOf(" #");
      if (comment_idx !== -1 && !line.slice(eq_idx + 1).trim().startsWith('"')) {
        value = value.slice(0, comment_idx).trim();
      }

      result[key] = value;
    }
    return result;
  }
}
