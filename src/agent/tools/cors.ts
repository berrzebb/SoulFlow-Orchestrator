/** CORS 도구 — CORS 헤더 생성/검증/preflight 응답 빌드. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class CorsTool extends Tool {
  readonly name = "cors";
  readonly category = "data" as const;
  readonly description = "CORS utilities: build_headers, check_origin, preflight, parse, validate.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["build_headers", "check_origin", "preflight", "parse", "validate"], description: "Operation" },
      origin: { type: "string", description: "Request Origin header" },
      allowed_origins: { type: "string", description: "JSON array of allowed origins (or '*')" },
      allowed_methods: { type: "string", description: "JSON array of allowed methods" },
      allowed_headers: { type: "string", description: "JSON array of allowed headers" },
      expose_headers: { type: "string", description: "JSON array of exposed headers" },
      max_age: { type: "number", description: "Preflight cache max age (seconds)" },
      credentials: { type: "boolean", description: "Allow credentials" },
      headers: { type: "string", description: "JSON object of response headers to parse" },
      method: { type: "string", description: "Request method (preflight)" },
      request_headers: { type: "string", description: "Access-Control-Request-Headers value" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "build_headers");

    switch (action) {
      case "build_headers": {
        const headers: Record<string, string> = {};
        let origins: string[];
        try { origins = JSON.parse(String(params.allowed_origins || '["*"]')); } catch { origins = [String(params.allowed_origins || "*")]; }
        const origin = String(params.origin || "");
        if (origins.includes("*") && !params.credentials) {
          headers["Access-Control-Allow-Origin"] = "*";
        } else if (origin && this.match_origin(origin, origins)) {
          headers["Access-Control-Allow-Origin"] = origin;
          headers["Vary"] = "Origin";
        }
        if (params.credentials) headers["Access-Control-Allow-Credentials"] = "true";
        if (params.allowed_methods) {
          let methods: string[];
          try { methods = JSON.parse(String(params.allowed_methods)); } catch { methods = [String(params.allowed_methods)]; }
          headers["Access-Control-Allow-Methods"] = methods.join(", ");
        }
        if (params.allowed_headers) {
          let hdrs: string[];
          try { hdrs = JSON.parse(String(params.allowed_headers)); } catch { hdrs = [String(params.allowed_headers)]; }
          headers["Access-Control-Allow-Headers"] = hdrs.join(", ");
        }
        if (params.expose_headers) {
          let exp: string[];
          try { exp = JSON.parse(String(params.expose_headers)); } catch { exp = [String(params.expose_headers)]; }
          headers["Access-Control-Expose-Headers"] = exp.join(", ");
        }
        if (params.max_age) headers["Access-Control-Max-Age"] = String(params.max_age);
        return JSON.stringify(headers);
      }
      case "check_origin": {
        const origin = String(params.origin || "");
        let origins: string[];
        try { origins = JSON.parse(String(params.allowed_origins || '["*"]')); } catch { origins = ["*"]; }
        const allowed = this.match_origin(origin, origins);
        return JSON.stringify({ origin, allowed, matched: allowed ? (origins.includes("*") ? "*" : origin) : null });
      }
      case "preflight": {
        const origin = String(params.origin || "");
        const method = String(params.method || "GET");
        let origins: string[];
        try { origins = JSON.parse(String(params.allowed_origins || '["*"]')); } catch { origins = ["*"]; }
        let methods: string[];
        try { methods = JSON.parse(String(params.allowed_methods || '["GET","POST","PUT","DELETE","PATCH"]')); } catch { methods = ["GET"]; }
        const origin_ok = this.match_origin(origin, origins);
        const method_ok = methods.map((m) => m.toUpperCase()).includes(method.toUpperCase());
        const headers: Record<string, string> = {};
        if (origin_ok) {
          headers["Access-Control-Allow-Origin"] = origins.includes("*") ? "*" : origin;
          headers["Access-Control-Allow-Methods"] = methods.join(", ");
          if (params.allowed_headers) headers["Access-Control-Allow-Headers"] = String(params.allowed_headers);
          else if (params.request_headers) headers["Access-Control-Allow-Headers"] = String(params.request_headers);
          if (params.max_age) headers["Access-Control-Max-Age"] = String(params.max_age);
          if (params.credentials) headers["Access-Control-Allow-Credentials"] = "true";
        }
        return JSON.stringify({ allowed: origin_ok && method_ok, headers });
      }
      case "parse": {
        let hdrs: Record<string, string>;
        try { hdrs = JSON.parse(String(params.headers || "{}")); } catch { return JSON.stringify({ error: "invalid headers JSON" }); }
        const norm: Record<string, string> = {};
        for (const [k, v] of Object.entries(hdrs)) norm[k.toLowerCase()] = v;
        return JSON.stringify({
          allow_origin: norm["access-control-allow-origin"],
          allow_methods: norm["access-control-allow-methods"]?.split(",").map((s) => s.trim()),
          allow_headers: norm["access-control-allow-headers"]?.split(",").map((s) => s.trim()),
          expose_headers: norm["access-control-expose-headers"]?.split(",").map((s) => s.trim()),
          max_age: norm["access-control-max-age"] ? Number(norm["access-control-max-age"]) : undefined,
          credentials: norm["access-control-allow-credentials"] === "true",
        });
      }
      case "validate": {
        let hdrs: Record<string, string>;
        try { hdrs = JSON.parse(String(params.headers || "{}")); } catch { return JSON.stringify({ error: "invalid headers JSON" }); }
        const norm: Record<string, string> = {};
        for (const [k, v] of Object.entries(hdrs)) norm[k.toLowerCase()] = v;
        const errors: string[] = [];
        const ao = norm["access-control-allow-origin"];
        if (!ao) errors.push("missing Access-Control-Allow-Origin");
        if (ao === "*" && norm["access-control-allow-credentials"] === "true") {
          errors.push("wildcard origin with credentials is invalid");
        }
        return JSON.stringify({ valid: errors.length === 0, errors });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private match_origin(origin: string, allowed: string[]): boolean {
    if (allowed.includes("*")) return true;
    return allowed.some((a) => {
      if (a === origin) return true;
      if (a.startsWith("*.")) {
        const suffix = a.slice(1);
        try { return new URL(origin).hostname.endsWith(suffix); } catch { return false; }
      }
      return false;
    });
  }
}
