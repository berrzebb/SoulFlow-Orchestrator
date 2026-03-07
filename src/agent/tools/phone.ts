/** Phone 도구 — 전화번호 파싱/검증/포맷팅. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

const COUNTRY_CODES: Record<string, { code: string; format: string; length: number[] }> = {
  US: { code: "+1", format: "(XXX) XXX-XXXX", length: [10] },
  KR: { code: "+82", format: "0XX-XXXX-XXXX", length: [10, 11] },
  JP: { code: "+81", format: "0XX-XXXX-XXXX", length: [10, 11] },
  CN: { code: "+86", format: "XXX XXXX XXXX", length: [11] },
  GB: { code: "+44", format: "0XXXX XXXXXX", length: [10, 11] },
  DE: { code: "+49", format: "0XXX XXXXXXXX", length: [10, 11, 12] },
  FR: { code: "+33", format: "0X XX XX XX XX", length: [10] },
  IN: { code: "+91", format: "XXXXX XXXXX", length: [10] },
  AU: { code: "+61", format: "0XXX XXX XXX", length: [9, 10] },
  BR: { code: "+55", format: "(XX) XXXXX-XXXX", length: [10, 11] },
};

export class PhoneTool extends Tool {
  readonly name = "phone";
  readonly category = "data" as const;
  readonly description = "Phone number utilities: parse, format, validate, normalize, country_info, compare.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["parse", "format", "validate", "normalize", "country_info", "compare"], description: "Operation" },
      number: { type: "string", description: "Phone number" },
      number2: { type: "string", description: "Second number (compare)" },
      country: { type: "string", description: "Country code (ISO 3166-1 alpha-2)" },
      format_type: { type: "string", description: "Format type: international, national, e164" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "parse");

    switch (action) {
      case "parse": {
        const num = String(params.number || "");
        const country = String(params.country || "").toUpperCase();
        return JSON.stringify(this.parse_phone(num, country));
      }
      case "format": {
        const num = String(params.number || "");
        const country = String(params.country || "").toUpperCase();
        const fmt = String(params.format_type || "international");
        const parsed = this.parse_phone(num, country);
        return JSON.stringify({ formatted: this.format_phone(parsed.digits, parsed.country_code || country, fmt) });
      }
      case "validate": {
        const num = String(params.number || "");
        const country = String(params.country || "").toUpperCase();
        const parsed = this.parse_phone(num, country);
        const info = COUNTRY_CODES[parsed.country_code || ""];
        const valid = !!info && info.length.includes(parsed.digits.length);
        return JSON.stringify({ number: num, valid, parsed });
      }
      case "normalize": {
        const num = String(params.number || "");
        const digits = num.replace(/\D/g, "");
        return JSON.stringify({ original: num, normalized: digits, e164: `+${digits}` });
      }
      case "country_info": {
        const country = String(params.country || "").toUpperCase();
        const info = COUNTRY_CODES[country];
        if (!info) return JSON.stringify({ error: `unknown country: ${country}`, supported: Object.keys(COUNTRY_CODES) });
        return JSON.stringify({ country, ...info });
      }
      case "compare": {
        const d1 = String(params.number || "").replace(/\D/g, "");
        const d2 = String(params.number2 || "").replace(/\D/g, "");
        const match = d1 === d2 || d1.endsWith(d2) || d2.endsWith(d1);
        return JSON.stringify({ number1: d1, number2: d2, match });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private parse_phone(num: string, hint_country: string): { digits: string; country_code?: string; dial_code?: string } {
    const cleaned = num.replace(/[\s\-().]/g, "");
    if (cleaned.startsWith("+")) {
      for (const [cc, info] of Object.entries(COUNTRY_CODES)) {
        if (cleaned.startsWith(info.code)) {
          return { digits: cleaned.slice(info.code.length), country_code: cc, dial_code: info.code };
        }
      }
      return { digits: cleaned.slice(1) };
    }
    if (hint_country && COUNTRY_CODES[hint_country]) {
      let digits = cleaned;
      if (digits.startsWith("0")) digits = digits.slice(1);
      return { digits, country_code: hint_country, dial_code: COUNTRY_CODES[hint_country].code };
    }
    return { digits: cleaned.replace(/\D/g, "") };
  }

  private format_phone(digits: string, country: string, fmt: string): string {
    const info = COUNTRY_CODES[country];
    if (!info) return digits;
    switch (fmt) {
      case "e164": return `${info.code}${digits}`;
      case "international": return `${info.code} ${digits}`;
      case "national": {
        if (country === "US" && digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
        if (country === "KR" && digits.length >= 9) return `0${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
        return `0${digits}`;
      }
      default: return digits;
    }
  }
}
