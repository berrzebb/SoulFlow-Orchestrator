/** Cookie 도구 — HTTP Cookie 파싱/직렬화/검증/jar 관리. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

interface CookieAttrs {
  name: string; value: string; domain?: string; path?: string;
  expires?: string; max_age?: number; secure?: boolean;
  http_only?: boolean; same_site?: string;
}

export class CookieTool extends Tool {
  readonly name = "cookie";
  readonly category = "data" as const;
  readonly description = "HTTP Cookie utilities: parse, serialize, parse_set_cookie, build_set_cookie, validate, jar_merge, is_expired.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["parse", "serialize", "parse_set_cookie", "build_set_cookie", "validate", "jar_merge", "is_expired"], description: "Operation" },
      cookie: { type: "string", description: "Cookie header string" },
      set_cookie: { type: "string", description: "Set-Cookie header string" },
      name: { type: "string", description: "Cookie name" },
      value: { type: "string", description: "Cookie value" },
      domain: { type: "string", description: "Domain attribute" },
      path: { type: "string", description: "Path attribute" },
      max_age: { type: "number", description: "Max-Age in seconds" },
      secure: { type: "boolean", description: "Secure flag" },
      http_only: { type: "boolean", description: "HttpOnly flag" },
      same_site: { type: "string", description: "SameSite (Strict/Lax/None)" },
      expires: { type: "string", description: "Expires date string" },
      jar: { type: "string", description: "JSON array of cookies (jar_merge)" },
      jar2: { type: "string", description: "JSON array of cookies to merge" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "parse");

    switch (action) {
      case "parse": {
        const header = String(params.cookie || "");
        const cookies: Record<string, string> = {};
        for (const pair of header.split(";")) {
          const eq = pair.indexOf("=");
          if (eq > 0) {
            const k = pair.slice(0, eq).trim();
            const v = pair.slice(eq + 1).trim();
            cookies[k] = v;
          }
        }
        return JSON.stringify({ count: Object.keys(cookies).length, cookies });
      }
      case "serialize": {
        const cookies: Record<string, string> = {};
        if (params.name && params.value !== undefined) {
          cookies[String(params.name)] = String(params.value);
        }
        const parts = Object.entries(cookies).map(([k, v]) => `${k}=${v}`);
        return parts.join("; ");
      }
      case "parse_set_cookie": {
        const header = String(params.set_cookie || "");
        return JSON.stringify(this.parse_set_cookie(header));
      }
      case "build_set_cookie": {
        const attrs: CookieAttrs = {
          name: String(params.name || ""),
          value: String(params.value || ""),
          domain: params.domain ? String(params.domain) : undefined,
          path: params.path ? String(params.path) : undefined,
          expires: params.expires ? String(params.expires) : undefined,
          max_age: params.max_age ? Number(params.max_age) : undefined,
          secure: params.secure ? Boolean(params.secure) : undefined,
          http_only: params.http_only ? Boolean(params.http_only) : undefined,
          same_site: params.same_site ? String(params.same_site) : undefined,
        };
        return this.build_set_cookie(attrs);
      }
      case "validate": {
        const header = String(params.set_cookie || params.cookie || "");
        const errors: string[] = [];
        if (!header) errors.push("empty cookie string");
        const eq = header.indexOf("=");
        if (eq < 1) errors.push("missing name=value pair");
        else {
          const name = header.slice(0, eq).trim();
          if (/[\s,;=]/.test(name)) errors.push("invalid characters in cookie name");
        }
        if (params.same_site) {
          const ss = String(params.same_site);
          if (!["Strict", "Lax", "None"].includes(ss)) errors.push(`invalid SameSite: ${ss}`);
          if (ss === "None" && !params.secure) errors.push("SameSite=None requires Secure flag");
        }
        return JSON.stringify({ valid: errors.length === 0, errors });
      }
      case "jar_merge": {
        let jar1: CookieAttrs[], jar2: CookieAttrs[];
        try { jar1 = JSON.parse(String(params.jar || "[]")); } catch { return JSON.stringify({ error: "invalid jar JSON" }); }
        try { jar2 = JSON.parse(String(params.jar2 || "[]")); } catch { return JSON.stringify({ error: "invalid jar2 JSON" }); }
        const merged = new Map<string, CookieAttrs>();
        for (const c of [...jar1, ...jar2]) {
          merged.set(`${c.name}@${c.domain || ""}@${c.path || "/"}`, c);
        }
        const result = [...merged.values()];
        return JSON.stringify({ count: result.length, cookies: result });
      }
      case "is_expired": {
        const header = String(params.set_cookie || "");
        const parsed = this.parse_set_cookie(header);
        let expired = false;
        if (parsed.expires) {
          const exp = new Date(parsed.expires);
          expired = exp.getTime() < Date.now();
        }
        if (parsed.max_age !== undefined && parsed.max_age <= 0) expired = true;
        return JSON.stringify({ expired, ...parsed });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private parse_set_cookie(header: string): CookieAttrs {
    const parts = header.split(";").map((s) => s.trim());
    const first = parts[0] || "";
    const eq = first.indexOf("=");
    const result: CookieAttrs = {
      name: eq > 0 ? first.slice(0, eq).trim() : "",
      value: eq > 0 ? first.slice(eq + 1).trim() : "",
    };
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      const peq = p.indexOf("=");
      const key = (peq > 0 ? p.slice(0, peq) : p).trim().toLowerCase();
      const val = peq > 0 ? p.slice(peq + 1).trim() : "";
      switch (key) {
        case "domain": result.domain = val; break;
        case "path": result.path = val; break;
        case "expires": result.expires = val; break;
        case "max-age": result.max_age = Number(val); break;
        case "secure": result.secure = true; break;
        case "httponly": result.http_only = true; break;
        case "samesite": result.same_site = val; break;
      }
    }
    return result;
  }

  private build_set_cookie(attrs: CookieAttrs): string {
    let s = `${attrs.name}=${attrs.value}`;
    if (attrs.domain) s += `; Domain=${attrs.domain}`;
    if (attrs.path) s += `; Path=${attrs.path}`;
    if (attrs.expires) s += `; Expires=${attrs.expires}`;
    if (attrs.max_age !== undefined) s += `; Max-Age=${attrs.max_age}`;
    if (attrs.secure) s += "; Secure";
    if (attrs.http_only) s += "; HttpOnly";
    if (attrs.same_site) s += `; SameSite=${attrs.same_site}`;
    return s;
  }
}
