/** Env 도구 — 환경변수 읽기/검증/기본값 적용. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class EnvTool extends Tool {
  readonly name = "env";
  readonly category = "data" as const;
  readonly description = "Environment variable operations: get, list, check, required, defaults.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["get", "list", "check", "required", "defaults"], description: "Env operation" },
      key: { type: "string", description: "Environment variable name (get)" },
      keys: { type: "string", description: "Comma-separated variable names (check/required/defaults)" },
      defaults: { type: "string", description: "JSON object of key:default pairs (defaults action)" },
      prefix: { type: "string", description: "Filter prefix for list (e.g. 'AWS_')" },
      mask: { type: "boolean", description: "Mask values in output (default: true)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "get");
    const should_mask = params.mask !== false;

    switch (action) {
      case "get": {
        const key = String(params.key || "");
        if (!key) return "Error: key is required";
        const value = process.env[key];
        return JSON.stringify({ key, exists: value !== undefined, value: value ? (should_mask ? this.mask(value) : value) : null });
      }
      case "list": {
        const prefix = String(params.prefix || "");
        const entries = Object.entries(process.env)
          .filter(([k]) => !prefix || k.startsWith(prefix))
          .map(([k, v]) => ({ key: k, value: should_mask ? this.mask(v || "") : v }));
        return JSON.stringify({ variables: entries, count: entries.length });
      }
      case "check": {
        const keys = String(params.keys || "").split(",").map((k) => k.trim()).filter(Boolean);
        const results = keys.map((k) => ({ key: k, exists: k in process.env, set: !!process.env[k] }));
        const all_set = results.every((r) => r.set);
        return JSON.stringify({ results, all_set });
      }
      case "required": {
        const keys = String(params.keys || "").split(",").map((k) => k.trim()).filter(Boolean);
        const missing = keys.filter((k) => !process.env[k]);
        return JSON.stringify({ valid: missing.length === 0, missing, checked: keys.length });
      }
      case "defaults": {
        let defs: Record<string, string>;
        try { defs = JSON.parse(String(params.defaults || "{}")); } catch { return "Error: defaults must be valid JSON object"; }
        const applied: Record<string, { source: string; value: string }> = {};
        for (const [k, def] of Object.entries(defs)) {
          const env_val = process.env[k];
          applied[k] = env_val
            ? { source: "env", value: should_mask ? this.mask(env_val) : env_val }
            : { source: "default", value: def };
        }
        return JSON.stringify({ resolved: applied });
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private mask(value: string): string {
    if (value.length <= 4) return "****";
    return value.slice(0, 2) + "*".repeat(Math.min(value.length - 4, 20)) + value.slice(-2);
  }
}
