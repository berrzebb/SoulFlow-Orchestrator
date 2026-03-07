/** CSP 도구 — Content-Security-Policy 빌드/파싱/검증. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

const VALID_DIRECTIVES = new Set([
  "default-src", "script-src", "style-src", "img-src", "font-src",
  "connect-src", "media-src", "object-src", "frame-src", "child-src",
  "worker-src", "manifest-src", "base-uri", "form-action", "frame-ancestors",
  "navigate-to", "report-uri", "report-to", "upgrade-insecure-requests",
  "block-all-mixed-content", "sandbox",
]);

export class CspTool extends Tool {
  readonly name = "csp";
  readonly category = "data" as const;
  readonly description = "Content-Security-Policy utilities: build, parse, validate, merge, check_source.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["build", "parse", "validate", "merge", "check_source"], description: "Operation" },
      directives: { type: "string", description: "JSON object of directives {directive: [sources]}" },
      policy: { type: "string", description: "CSP policy string" },
      policy2: { type: "string", description: "Second policy (merge)" },
      directive: { type: "string", description: "Directive name (check_source)" },
      source: { type: "string", description: "Source to check" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "build");

    switch (action) {
      case "build": {
        let directives: Record<string, string[]>;
        try { directives = JSON.parse(String(params.directives || "{}")); } catch { return JSON.stringify({ error: "invalid directives JSON" }); }
        const parts: string[] = [];
        for (const [k, v] of Object.entries(directives)) {
          if (Array.isArray(v) && v.length > 0) parts.push(`${k} ${v.join(" ")}`);
          else parts.push(k);
        }
        return parts.join("; ");
      }
      case "parse": {
        const policy = String(params.policy || "");
        const directives: Record<string, string[]> = {};
        for (const part of policy.split(";")) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          const tokens = trimmed.split(/\s+/);
          const name = tokens[0];
          directives[name] = tokens.slice(1);
        }
        return JSON.stringify({ directive_count: Object.keys(directives).length, directives });
      }
      case "validate": {
        const policy = String(params.policy || "");
        const errors: string[] = [];
        const warnings: string[] = [];
        const directives: Record<string, string[]> = {};
        for (const part of policy.split(";")) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          const tokens = trimmed.split(/\s+/);
          const name = tokens[0];
          if (!VALID_DIRECTIVES.has(name)) errors.push(`unknown directive: ${name}`);
          directives[name] = tokens.slice(1);
        }
        if (!directives["default-src"] && !directives["script-src"]) {
          warnings.push("missing default-src or script-src");
        }
        for (const [d, sources] of Object.entries(directives)) {
          if (sources.includes("'unsafe-inline'")) warnings.push(`${d}: unsafe-inline weakens CSP`);
          if (sources.includes("'unsafe-eval'")) warnings.push(`${d}: unsafe-eval weakens CSP`);
          if (sources.includes("*")) warnings.push(`${d}: wildcard source allows any origin`);
        }
        return JSON.stringify({ valid: errors.length === 0, errors, warnings });
      }
      case "merge": {
        const p1 = this.parse_policy(String(params.policy || ""));
        const p2 = this.parse_policy(String(params.policy2 || ""));
        const merged: Record<string, Set<string>> = {};
        for (const [k, v] of Object.entries(p1)) {
          merged[k] = new Set(v);
        }
        for (const [k, v] of Object.entries(p2)) {
          if (!merged[k]) merged[k] = new Set();
          for (const s of v) merged[k].add(s);
        }
        const result: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(merged)) result[k] = [...v];
        const parts = Object.entries(result).map(([k, v]) => v.length > 0 ? `${k} ${v.join(" ")}` : k);
        return parts.join("; ");
      }
      case "check_source": {
        const policy = String(params.policy || "");
        const directive = String(params.directive || "script-src");
        const source = String(params.source || "");
        const parsed = this.parse_policy(policy);
        const sources = parsed[directive] || parsed["default-src"] || [];
        const allowed = sources.includes("*") || sources.includes(source) ||
          sources.some((s) => s.startsWith("*.") && source.endsWith(s.slice(1)));
        return JSON.stringify({ directive, source, allowed, applicable_sources: sources });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private parse_policy(policy: string): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const part of policy.split(";")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const tokens = trimmed.split(/\s+/);
      result[tokens[0]] = tokens.slice(1);
    }
    return result;
  }
}
