/** Slug 도구 — URL slug/파일명 새니타이즈/텍스트 정규화. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class SlugTool extends Tool {
  readonly name = "slug";
  readonly category = "data" as const;
  readonly description = "Text normalization: slugify, filename_safe, camel_to_snake, snake_to_camel, truncate, transliterate.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["slugify", "filename_safe", "camel_to_snake", "snake_to_camel", "truncate", "transliterate"], description: "Slug operation" },
      input: { type: "string", description: "Input text" },
      separator: { type: "string", description: "Separator for slug (default: -)" },
      max_length: { type: "integer", description: "Maximum length for truncate (default: 80)" },
      lowercase: { type: "boolean", description: "Force lowercase (default: true)" },
    },
    required: ["action", "input"],
    additionalProperties: false,
  };

  private readonly TRANSLITERATE_MAP: Record<string, string> = {
    "\u00E0": "a", "\u00E1": "a", "\u00E2": "a", "\u00E3": "a", "\u00E4": "a", "\u00E5": "a",
    "\u00E8": "e", "\u00E9": "e", "\u00EA": "e", "\u00EB": "e",
    "\u00EC": "i", "\u00ED": "i", "\u00EE": "i", "\u00EF": "i",
    "\u00F2": "o", "\u00F3": "o", "\u00F4": "o", "\u00F5": "o", "\u00F6": "o",
    "\u00F9": "u", "\u00FA": "u", "\u00FB": "u", "\u00FC": "u",
    "\u00F1": "n", "\u00E7": "c", "\u00DF": "ss",
    "\u00C0": "A", "\u00C1": "A", "\u00C2": "A", "\u00C3": "A", "\u00C4": "A", "\u00C5": "A",
    "\u00C8": "E", "\u00C9": "E", "\u00CA": "E", "\u00CB": "E",
    "\u00D1": "N", "\u00D6": "O", "\u00DC": "U",
    "\u00F8": "o", "\u00D8": "O", "\u00E6": "ae", "\u00C6": "AE",
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "slugify");
    const input = String(params.input || "");

    switch (action) {
      case "slugify": {
        const sep = String(params.separator || "-");
        const lower = params.lowercase !== false;
        let slug = this.transliterate(input);
        slug = slug.replace(/[^\w\s-]/g, "").trim();
        slug = slug.replace(/[\s_]+/g, sep);
        slug = slug.replace(new RegExp(`${this.escape_regex(sep)}+`, "g"), sep);
        if (lower) slug = slug.toLowerCase();
        return JSON.stringify({ slug });
      }
      case "filename_safe": {
        let safe = this.transliterate(input);
        safe = safe.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
        safe = safe.replace(/_+/g, "_").trim();
        if (params.lowercase !== false) safe = safe.toLowerCase();
        const max = Number(params.max_length) || 255;
        if (safe.length > max) safe = safe.slice(0, max);
        return JSON.stringify({ filename: safe });
      }
      case "camel_to_snake": {
        const snake = input
          .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
          .replace(/([a-z\d])([A-Z])/g, "$1_$2")
          .toLowerCase();
        return JSON.stringify({ result: snake });
      }
      case "snake_to_camel": {
        const camel = input.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
        return JSON.stringify({ result: camel });
      }
      case "truncate": {
        const max = Number(params.max_length) || 80;
        if (input.length <= max) return JSON.stringify({ result: input, truncated: false });
        const truncated = input.slice(0, max - 3).replace(/\s+\S*$/, "") + "...";
        return JSON.stringify({ result: truncated, truncated: true, original_length: input.length });
      }
      case "transliterate": {
        const result = this.transliterate(input);
        return JSON.stringify({ result });
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private transliterate(str: string): string {
    return str.split("").map((c) => this.TRANSLITERATE_MAP[c] || c).join("");
  }

  private escape_regex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
