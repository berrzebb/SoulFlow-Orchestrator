/** URL 도구 — URL 파싱/빌드/인코딩/쿼리 파라미터 조작. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class UrlTool extends Tool {
  readonly name = "url";
  readonly category = "data" as const;
  readonly description = "URL utilities: parse, build, resolve, encode, decode, query_params, join, normalize.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["parse", "build", "resolve", "encode", "decode", "query_params", "join", "normalize"], description: "URL operation" },
      url: { type: "string", description: "URL string" },
      base: { type: "string", description: "Base URL for resolve" },
      params: { type: "string", description: "JSON object of query params (build/query_params)" },
      component: { type: "string", description: "URL component to encode/decode (component/full, default: component)" },
      parts: { type: "string", description: "JSON object with protocol/host/pathname/search/hash (build)" },
      segments: { type: "string", description: "JSON array of path segments (join)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "parse");

    switch (action) {
      case "parse": {
        const url_str = String(params.url || "");
        try {
          const u = new URL(url_str);
          const query: Record<string, string> = {};
          u.searchParams.forEach((v, k) => { query[k] = v; });
          return JSON.stringify({
            protocol: u.protocol,
            host: u.host,
            hostname: u.hostname,
            port: u.port || null,
            pathname: u.pathname,
            search: u.search,
            hash: u.hash,
            origin: u.origin,
            username: u.username || null,
            password: u.password || null,
            query,
          });
        } catch {
          return JSON.stringify({ error: "invalid URL" });
        }
      }
      case "build": {
        let parts: Record<string, string>;
        try { parts = JSON.parse(String(params.parts || "{}")); } catch { return "Error: parts must be valid JSON"; }
        const protocol = parts.protocol || "https:";
        const host = parts.host || parts.hostname || "localhost";
        const pathname = parts.pathname || "/";
        let url_str = `${protocol}//${host}${pathname}`;
        if (params.params) {
          try {
            const qp = JSON.parse(String(params.params));
            const sp = new URLSearchParams();
            for (const [k, v] of Object.entries(qp)) sp.set(k, String(v));
            const qs = sp.toString();
            if (qs) url_str += `?${qs}`;
          } catch { /* ignore */ }
        } else if (parts.search) {
          url_str += parts.search.startsWith("?") ? parts.search : `?${parts.search}`;
        }
        if (parts.hash) url_str += parts.hash.startsWith("#") ? parts.hash : `#${parts.hash}`;
        return JSON.stringify({ url: url_str });
      }
      case "resolve": {
        const base = String(params.base || params.url || "");
        const relative = String(params.url || "");
        if (!params.base) return "Error: base is required for resolve";
        try {
          const resolved = new URL(relative, base);
          return JSON.stringify({ url: resolved.href });
        } catch {
          return JSON.stringify({ error: "cannot resolve URL" });
        }
      }
      case "encode": {
        const input = String(params.url || "");
        const component = String(params.component || "component");
        const encoded = component === "full" ? encodeURI(input) : encodeURIComponent(input);
        return JSON.stringify({ encoded });
      }
      case "decode": {
        const input = String(params.url || "");
        const component = String(params.component || "component");
        try {
          const decoded = component === "full" ? decodeURI(input) : decodeURIComponent(input);
          return JSON.stringify({ decoded });
        } catch {
          return JSON.stringify({ error: "invalid encoded string" });
        }
      }
      case "query_params": {
        const url_str = String(params.url || "");
        try {
          const u = new URL(url_str);
          if (params.params) {
            const updates = JSON.parse(String(params.params));
            for (const [k, v] of Object.entries(updates)) {
              if (v === null || v === "") u.searchParams.delete(k);
              else u.searchParams.set(k, String(v));
            }
            return JSON.stringify({ url: u.href });
          }
          const query: Record<string, string> = {};
          u.searchParams.forEach((v, k) => { query[k] = v; });
          return JSON.stringify({ params: query, count: Object.keys(query).length });
        } catch {
          return JSON.stringify({ error: "invalid URL" });
        }
      }
      case "join": {
        let segments: string[];
        try { segments = JSON.parse(String(params.segments || "[]")); } catch { return "Error: segments must be a JSON array"; }
        const joined = segments
          .map((s, i) => i === 0 ? s.replace(/\/+$/, "") : s.replace(/^\/+|\/+$/g, ""))
          .filter(Boolean)
          .join("/");
        return JSON.stringify({ path: joined });
      }
      case "normalize": {
        const url_str = String(params.url || "");
        try {
          const u = new URL(url_str);
          u.searchParams.sort();
          const normalized = u.href.replace(/\/+$/, "");
          return JSON.stringify({ url: normalized });
        } catch {
          return JSON.stringify({ error: "invalid URL" });
        }
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }
}
