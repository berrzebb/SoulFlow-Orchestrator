/** Base Convert 도구 — 수치 base 변환 + 바이트 크기 변환. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class BaseConvertTool extends Tool {
  readonly name = "base_convert";
  readonly category = "data" as const;
  readonly description = "Number base conversion: convert, bytes_format, bytes_parse, int_to_roman, roman_to_int.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["convert", "bytes_format", "bytes_parse", "int_to_roman", "roman_to_int"], description: "Conversion operation" },
      value: { type: "string", description: "Value to convert" },
      from: { type: "string", description: "Source base: bin/oct/dec/hex/base32/base36/base62 (default: dec)" },
      to: { type: "string", description: "Target base (default: hex)" },
      bytes: { type: "number", description: "Byte count for bytes_format" },
      precision: { type: "integer", description: "Decimal precision for bytes_format (default: 2)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  private readonly BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  private readonly BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "convert");

    switch (action) {
      case "convert": {
        const value = String(params.value || "0");
        const from = String(params.from || "dec");
        const to = String(params.to || "hex");
        const decimal = this.to_decimal(value, from);
        if (decimal === null) return `Error: cannot parse "${value}" as ${from}`;
        const result = this.from_decimal(decimal, to);
        return JSON.stringify({ input: value, from, to, result, decimal });
      }
      case "bytes_format": {
        const bytes = Number(params.bytes ?? params.value ?? 0);
        const precision = Number(params.precision ?? 2);
        const units = ["B", "KB", "MB", "GB", "TB", "PB", "EB"];
        let size = Math.abs(bytes);
        let unit_idx = 0;
        while (size >= 1024 && unit_idx < units.length - 1) { size /= 1024; unit_idx++; }
        const formatted = `${size.toFixed(precision)} ${units[unit_idx]}`;
        return JSON.stringify({ formatted, bytes, unit: units[unit_idx], value: Number(size.toFixed(precision)) });
      }
      case "bytes_parse": {
        const input = String(params.value || "0");
        const match = input.match(/^([\d.]+)\s*(B|KB|MB|GB|TB|PB|EB|KiB|MiB|GiB|TiB)$/i);
        if (!match) return "Error: cannot parse byte string (e.g. '1.5 GB')";
        const num = Number(match[1]);
        const unit = match[2]!.toUpperCase();
        const multipliers: Record<string, number> = {
          B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4, PB: 1024 ** 5, EB: 1024 ** 6,
          KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4,
        };
        const bytes_val = Math.round(num * (multipliers[unit] || 1));
        return JSON.stringify({ bytes: bytes_val, input });
      }
      case "int_to_roman": {
        const num = Number(params.value || 0);
        if (num < 1 || num > 3999 || !Number.isInteger(num)) return "Error: value must be integer 1-3999";
        const values = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
        const symbols = ["M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"];
        let result = "";
        let remaining = num;
        for (let i = 0; i < values.length; i++) {
          while (remaining >= values[i]!) { result += symbols[i]; remaining -= values[i]!; }
        }
        return JSON.stringify({ roman: result, integer: num });
      }
      case "roman_to_int": {
        const roman = String(params.value || "").toUpperCase();
        const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
        let result = 0;
        for (let i = 0; i < roman.length; i++) {
          const current = map[roman[i]!] || 0;
          const next = map[roman[i + 1]!] || 0;
          result += current < next ? -current : current;
        }
        return JSON.stringify({ integer: result, roman });
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private to_decimal(value: string, base: string): number | null {
    switch (base) {
      case "bin": return parseInt(value, 2) || null;
      case "oct": return parseInt(value, 8) || null;
      case "dec": return Number(value);
      case "hex": return parseInt(value.replace(/^0x/i, ""), 16);
      case "base36": return parseInt(value, 36);
      case "base32": {
        let result = 0;
        for (const c of value.toUpperCase().replace(/=/g, "")) {
          const idx = this.BASE32.indexOf(c);
          if (idx === -1) return null;
          result = result * 32 + idx;
        }
        return result;
      }
      case "base62": {
        let result = 0;
        for (const c of value) {
          const idx = this.BASE62.indexOf(c);
          if (idx === -1) return null;
          result = result * 62 + idx;
        }
        return result;
      }
      default: return null;
    }
  }

  private from_decimal(n: number, base: string): string {
    if (n === 0) return "0";
    switch (base) {
      case "bin": return n.toString(2);
      case "oct": return n.toString(8);
      case "dec": return n.toString(10);
      case "hex": return n.toString(16);
      case "base36": return n.toString(36);
      case "base32": {
        let result = "";
        let val = Math.abs(n);
        while (val > 0) { result = this.BASE32[val % 32] + result; val = Math.floor(val / 32); }
        return result;
      }
      case "base62": {
        let result = "";
        let val = Math.abs(n);
        while (val > 0) { result = this.BASE62[val % 62] + result; val = Math.floor(val / 62); }
        return result;
      }
      default: return n.toString();
    }
  }
}
