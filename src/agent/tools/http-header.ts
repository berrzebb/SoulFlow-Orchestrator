/** HttpHeader 도구 — 범용 HTTP 헤더 파서/빌더 (RFC 8941 구조화 헤더). */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

function parse_list(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function parse_params(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  const parts = value.split(";").map((s) => s.trim());
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) { result[part] = ""; continue; }
    const k = part.slice(0, eq).trim().toLowerCase();
    let v = part.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    result[k] = v;
  }
  return result;
}

export class HttpHeaderTool extends Tool {
  readonly name = "http_header";
  readonly category = "data" as const;
  readonly description = "HTTP header operations: parse, build, content_type, accept, cache_control, authorization, content_disposition.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["parse", "build", "content_type", "accept", "cache_control", "authorization", "content_disposition"], description: "Operation" },
      header: { type: "string", description: "Raw header value to parse" },
      headers: { type: "string", description: "JSON object of header name-value pairs" },
      type: { type: "string", description: "Media type or auth scheme" },
      params: { type: "string", description: "JSON object of parameters" },
      directives: { type: "string", description: "JSON object of cache-control directives" },
      token: { type: "string", description: "Auth token/credentials" },
      filename: { type: "string", description: "Filename for content-disposition" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "parse");

    switch (action) {
      case "parse": {
        const header = String(params.header || "");
        const parsed = parse_params(header);
        const list = parse_list(header);
        return JSON.stringify({ raw: header, params: parsed, list, parts_count: list.length });
      }
      case "build": {
        let headers: Record<string, string>;
        try { headers = JSON.parse(String(params.headers || "{}")); } catch { return JSON.stringify({ error: "invalid headers JSON" }); }
        const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
        return JSON.stringify({ headers, text: lines.join("\r\n"), count: lines.length });
      }
      case "content_type": {
        const type = String(params.type || "application/json");
        let extra: Record<string, string> = {};
        try { extra = params.params ? JSON.parse(String(params.params)) : {}; } catch { extra = {}; }
        const parts = [type, ...Object.entries(extra).map(([k, v]) => `${k}=${v}`)];
        const value = parts.join("; ");
        const parsed = parse_params(value);
        return JSON.stringify({ header: "Content-Type", value, media_type: type, params: parsed });
      }
      case "accept": {
        const header = String(params.header || "");
        const types = parse_list(header).map((t) => {
          const p = parse_params(t);
          const q = p["q"] ? parseFloat(p["q"]) : 1.0;
          const media = Object.keys(p)[0] || t.split(";")[0].trim();
          return { media_type: media, quality: q };
        });
        types.sort((a, b) => b.quality - a.quality);
        return JSON.stringify({ accept: types, preferred: types[0]?.media_type || null });
      }
      case "cache_control": {
        if (params.header) {
          const header = String(params.header);
          const directives: Record<string, string | boolean> = {};
          for (const part of parse_list(header)) {
            const eq = part.indexOf("=");
            if (eq === -1) directives[part.toLowerCase()] = true;
            else directives[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
          }
          return JSON.stringify({ header: "Cache-Control", directives });
        }
        let directives: Record<string, unknown> = {};
        try { directives = params.directives ? JSON.parse(String(params.directives)) : {}; } catch { directives = {}; }
        const parts = Object.entries(directives).map(([k, v]) => v === true ? k : `${k}=${v}`);
        return JSON.stringify({ header: "Cache-Control", value: parts.join(", "), directives });
      }
      case "authorization": {
        const scheme = String(params.type || "Bearer");
        const token = String(params.token || "");
        if (params.header) {
          const header = String(params.header);
          const space = header.indexOf(" ");
          const s = space === -1 ? header : header.slice(0, space);
          const t = space === -1 ? "" : header.slice(space + 1);
          return JSON.stringify({ header: "Authorization", scheme: s, credentials: t });
        }
        const value = `${scheme} ${token}`;
        return JSON.stringify({ header: "Authorization", value, scheme, credentials: token });
      }
      case "content_disposition": {
        const filename = String(params.filename || "");
        if (params.header) {
          const parsed = parse_params(String(params.header));
          return JSON.stringify({ header: "Content-Disposition", params: parsed });
        }
        const type = String(params.type || "attachment");
        let value = type;
        if (filename) {
          const ascii = /^[\x20-\x7E]+$/.test(filename);
          value += ascii ? `; filename="${filename}"` : `; filename*=UTF-8''${encodeURIComponent(filename)}`;
        }
        return JSON.stringify({ header: "Content-Disposition", value, type, filename });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }
}
