/** Lookup 도구 — 인메모리 룩업 테이블 (HTTP 상태 코드, MIME, 국가 코드 등). */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

const HTTP_CODES: Record<string, string> = {
  "100": "Continue", "101": "Switching Protocols", "200": "OK", "201": "Created",
  "202": "Accepted", "204": "No Content", "301": "Moved Permanently", "302": "Found",
  "304": "Not Modified", "307": "Temporary Redirect", "308": "Permanent Redirect",
  "400": "Bad Request", "401": "Unauthorized", "403": "Forbidden", "404": "Not Found",
  "405": "Method Not Allowed", "408": "Request Timeout", "409": "Conflict", "410": "Gone",
  "413": "Payload Too Large", "415": "Unsupported Media Type", "422": "Unprocessable Entity",
  "429": "Too Many Requests", "500": "Internal Server Error", "501": "Not Implemented",
  "502": "Bad Gateway", "503": "Service Unavailable", "504": "Gateway Timeout",
};

const MIME_TYPES: Record<string, string> = {
  html: "text/html", css: "text/css", js: "application/javascript", json: "application/json",
  xml: "application/xml", csv: "text/csv", txt: "text/plain", md: "text/markdown",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  svg: "image/svg+xml", webp: "image/webp", ico: "image/x-icon",
  pdf: "application/pdf", zip: "application/zip", gz: "application/gzip",
  mp3: "audio/mpeg", mp4: "video/mp4", webm: "video/webm", wav: "audio/wav",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  yaml: "application/yaml", yml: "application/yaml", toml: "application/toml",
  ts: "application/typescript", tsx: "application/typescript", jsx: "text/jsx",
  wasm: "application/wasm", tar: "application/x-tar",
};

const COUNTRY_CODES: Record<string, string> = {
  US: "United States", GB: "United Kingdom", DE: "Germany", FR: "France",
  JP: "Japan", KR: "South Korea", CN: "China", IN: "India", BR: "Brazil",
  CA: "Canada", AU: "Australia", IT: "Italy", ES: "Spain", MX: "Mexico",
  RU: "Russia", NL: "Netherlands", SE: "Sweden", NO: "Norway", DK: "Denmark",
  FI: "Finland", CH: "Switzerland", AT: "Austria", BE: "Belgium", PT: "Portugal",
  PL: "Poland", SG: "Singapore", HK: "Hong Kong", TW: "Taiwan", NZ: "New Zealand",
  IE: "Ireland", IL: "Israel", AE: "United Arab Emirates", SA: "Saudi Arabia",
  ZA: "South Africa", AR: "Argentina", CO: "Colombia", CL: "Chile",
  TH: "Thailand", VN: "Vietnam", MY: "Malaysia", PH: "Philippines", ID: "Indonesia",
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "\u20AC", GBP: "\u00A3", JPY: "\u00A5", KRW: "\u20A9",
  CNY: "\u00A5", INR: "\u20B9", BRL: "R$", CAD: "C$", AUD: "A$",
  CHF: "CHF", SEK: "kr", NOK: "kr", DKK: "kr", SGD: "S$",
  HKD: "HK$", TWD: "NT$", THB: "\u0E3F", MXN: "Mex$",
};

export class LookupTool extends Tool {
  readonly name = "lookup";
  readonly category = "memory" as const;
  readonly description =
    "Lookup reference data: HTTP status codes, MIME types, country codes, currency symbols. Also supports reverse lookup and listing all entries.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      table: { type: "string", enum: ["http_status", "mime_type", "country", "currency_symbol"], description: "Lookup table" },
      key: { type: "string", description: "Key to look up (e.g. 404, png, US, USD)" },
      reverse: { type: "boolean", description: "Reverse lookup (search by value)" },
      list: { type: "boolean", description: "List all entries in the table" },
    },
    required: ["table"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const table_name = String(params.table || "http_status");
    const table = this.get_table(table_name);
    if (!table) return `Error: unknown table "${table_name}"`;

    if (params.list) return JSON.stringify(table, null, 2);

    const key = String(params.key || "");
    if (!key) return "Error: key is required (or use list: true)";

    if (params.reverse) {
      const kl = key.toLowerCase();
      const matches: Record<string, string> = {};
      for (const [k, v] of Object.entries(table)) {
        if (v.toLowerCase().includes(kl)) matches[k] = v;
      }
      return Object.keys(matches).length > 0 ? JSON.stringify(matches, null, 2) : `No matches for "${key}"`;
    }

    const normalized = key.toUpperCase();
    const result = table[key] ?? table[normalized] ?? table[key.toLowerCase()];
    return result ?? `Not found: "${key}"`;
  }

  private get_table(name: string): Record<string, string> | null {
    switch (name) {
      case "http_status": return HTTP_CODES;
      case "mime_type": return MIME_TYPES;
      case "country": return COUNTRY_CODES;
      case "currency_symbol": return CURRENCY_SYMBOLS;
      default: return null;
    }
  }
}
