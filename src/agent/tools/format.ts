/** Format 도구 — 숫자/바이트/시간 포매팅, 마스킹, 통화/퍼센트 변환. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class FormatTool extends Tool {
  readonly name = "format";
  readonly category = "memory" as const;
  readonly description =
    "Format values for display: numbers with locale/currency, bytes to KB/MB/GB, relative time, percentages, masking (email/phone/card), ordinals, pluralization, duration.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: { type: "string", enum: ["number", "currency", "percent", "bytes", "relative_time", "mask", "ordinal", "plural", "duration", "pad", "truncate"], description: "Format operation" },
      value: { type: "string", description: "Value to format" },
      locale: { type: "string", description: "Locale code (e.g. en-US, ko-KR). Default: en-US" },
      currency: { type: "string", description: "Currency code (e.g. USD, KRW)" },
      decimals: { type: "integer", description: "Decimal places" },
      mask_type: { type: "string", enum: ["email", "phone", "card", "custom"], description: "Mask type" },
      mask_char: { type: "string", description: "Mask character (default: *)" },
      word: { type: "string", description: "Singular form (for plural)" },
      plural_word: { type: "string", description: "Plural form (for plural)" },
      width: { type: "integer", description: "Target width (for pad)" },
      fill: { type: "string", description: "Fill character (for pad, default: space)" },
      align: { type: "string", enum: ["left", "right", "center"], description: "Alignment (for pad)" },
      max_length: { type: "integer", description: "Max length (for truncate)" },
      suffix: { type: "string", description: "Truncation suffix (default: ...)" },
    },
    required: ["operation", "value"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const op = String(params.operation || "number");
    const value = String(params.value ?? "");

    switch (op) {
      case "number": return this.fmt_number(value, String(params.locale || "en-US"), Number(params.decimals ?? 0));
      case "currency": return this.fmt_currency(value, String(params.locale || "en-US"), String(params.currency || "USD"), Number(params.decimals ?? 2));
      case "percent": return this.fmt_percent(value, String(params.locale || "en-US"), Number(params.decimals ?? 1));
      case "bytes": return this.fmt_bytes(Number(value));
      case "relative_time": return this.fmt_relative_time(value);
      case "mask": return this.fmt_mask(value, String(params.mask_type || "custom"), String(params.mask_char || "*"));
      case "ordinal": return this.fmt_ordinal(Number(value));
      case "plural": return this.fmt_plural(Number(value), String(params.word || ""), String(params.plural_word || ""));
      case "duration": return this.fmt_duration(Number(value));
      case "pad": return this.fmt_pad(value, Number(params.width ?? 10), String(params.fill || " "), String(params.align || "right"));
      case "truncate": return this.fmt_truncate(value, Number(params.max_length ?? 50), String(params.suffix || "..."));
      default: return `Error: unsupported operation "${op}"`;
    }
  }

  private fmt_number(value: string, locale: string, decimals: number): string {
    const n = Number(value);
    if (!isFinite(n)) return "Error: invalid number";
    try {
      return new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
    } catch {
      return "Error: invalid locale";
    }
  }

  private fmt_currency(value: string, locale: string, currency: string, decimals: number): string {
    const n = Number(value);
    if (!isFinite(n)) return "Error: invalid number";
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
    } catch {
      return "Error: invalid locale or currency";
    }
  }

  private fmt_percent(value: string, locale: string, decimals: number): string {
    const n = Number(value);
    if (!isFinite(n)) return "Error: invalid number";
    try {
      return new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
    } catch {
      return "Error: invalid locale";
    }
  }

  private fmt_bytes(bytes: number): string {
    if (!isFinite(bytes) || bytes < 0) return "Error: invalid byte value";
    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    let idx = 0;
    let val = bytes;
    while (val >= 1024 && idx < units.length - 1) { val /= 1024; idx++; }
    return `${Math.round(val * 100) / 100} ${units[idx]}`;
  }

  private fmt_relative_time(value: string): string {
    const d = new Date(value);
    if (isNaN(d.getTime())) {
      const ms = Number(value);
      if (!isFinite(ms)) return "Error: invalid date or timestamp";
      return this.relative_from_ms(Date.now() - ms);
    }
    return this.relative_from_ms(Date.now() - d.getTime());
  }

  private relative_from_ms(diff: number): string {
    const abs = Math.abs(diff);
    const suffix = diff >= 0 ? "ago" : "from now";
    if (abs < 60_000) return `${Math.round(abs / 1000)}s ${suffix}`;
    if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m ${suffix}`;
    if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)}h ${suffix}`;
    if (abs < 2_592_000_000) return `${Math.round(abs / 86_400_000)}d ${suffix}`;
    if (abs < 31_536_000_000) return `${Math.round(abs / 2_592_000_000)}mo ${suffix}`;
    return `${Math.round(abs / 31_536_000_000)}y ${suffix}`;
  }

  private fmt_mask(value: string, type: string, char: string): string {
    const c = char[0] || "*";
    switch (type) {
      case "email": {
        const at = value.indexOf("@");
        if (at <= 0) return c.repeat(value.length);
        return value[0] + c.repeat(Math.max(at - 1, 0)) + value.slice(at);
      }
      case "phone": {
        const digits = value.replace(/\D/g, "");
        if (digits.length < 4) return c.repeat(value.length);
        return c.repeat(digits.length - 4) + digits.slice(-4);
      }
      case "card": {
        const nums = value.replace(/\D/g, "");
        if (nums.length < 4) return c.repeat(value.length);
        return c.repeat(nums.length - 4) + nums.slice(-4);
      }
      default: {
        if (value.length <= 2) return c.repeat(value.length);
        return value[0] + c.repeat(value.length - 2) + value[value.length - 1];
      }
    }
  }

  private fmt_ordinal(n: number): string {
    if (!isFinite(n)) return "Error: invalid number";
    const abs = Math.abs(n) % 100;
    if (abs >= 11 && abs <= 13) return `${n}th`;
    switch (abs % 10) {
      case 1: return `${n}st`;
      case 2: return `${n}nd`;
      case 3: return `${n}rd`;
      default: return `${n}th`;
    }
  }

  private fmt_plural(count: number, word: string, plural: string): string {
    if (!word) return "Error: word is required";
    const form = count === 1 ? word : (plural || `${word}s`);
    return `${count} ${form}`;
  }

  private fmt_duration(ms: number): string {
    if (!isFinite(ms)) return "Error: invalid duration";
    const abs = Math.abs(ms);
    const parts: string[] = [];
    const d = Math.floor(abs / 86_400_000);
    const h = Math.floor((abs % 86_400_000) / 3_600_000);
    const m = Math.floor((abs % 3_600_000) / 60_000);
    const s = Math.floor((abs % 60_000) / 1000);
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    if (s || parts.length === 0) parts.push(`${s}s`);
    return (ms < 0 ? "-" : "") + parts.join(" ");
  }

  private fmt_pad(value: string, width: number, fill: string, align: string): string {
    const pad_len = Math.max(0, width - value.length);
    const padding = fill.repeat(Math.ceil(pad_len / fill.length)).slice(0, pad_len);
    if (align === "left") return value + padding;
    if (align === "center") {
      const left = Math.floor(pad_len / 2);
      const right = pad_len - left;
      return fill.repeat(Math.ceil(left / fill.length)).slice(0, left) + value + fill.repeat(Math.ceil(right / fill.length)).slice(0, right);
    }
    return padding + value;
  }

  private fmt_truncate(value: string, max: number, suffix: string): string {
    if (value.length <= max) return value;
    return value.slice(0, max - suffix.length) + suffix;
  }
}
