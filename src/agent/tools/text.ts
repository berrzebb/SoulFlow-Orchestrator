/** Text 도구 — 텍스트 변환 (case, truncate, pad, slugify, word count, similarity). */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

const MAX_INPUT = 1024 * 512;

export class TextTool extends Tool {
  readonly name = "text";
  readonly category = "memory" as const;
  readonly description =
    "Text manipulation: case conversion, slugify, truncate, pad, word/char count, deduplicate lines, similarity (Levenshtein), join, wrap.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["upper", "lower", "title", "camel", "snake", "kebab", "slugify", "truncate", "pad", "count", "dedup", "similarity", "reverse", "join", "wrap", "trim_lines"],
        description: "Text operation",
      },
      input: { type: "string", description: "Input text" },
      input2: { type: "string", description: "Second input (for similarity)" },
      max_length: { type: "integer", minimum: 1, description: "Max length (for truncate)" },
      pad_char: { type: "string", description: "Pad character (for pad, default: space)" },
      pad_length: { type: "integer", minimum: 1, maximum: 1000, description: "Pad to this length" },
      pad_side: { type: "string", enum: ["left", "right", "both"], description: "Pad side (default: right)" },
      separator: { type: "string", description: "Separator for join (default: newline)" },
      width: { type: "integer", minimum: 10, maximum: 200, description: "Line width for wrap (default: 80)" },
    },
    required: ["operation", "input"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const op = String(params.operation || "count");
    const input = String(params.input || "");
    if (input.length > MAX_INPUT) return `Error: input exceeds ${MAX_INPUT} bytes`;

    switch (op) {
      case "upper": return input.toUpperCase();
      case "lower": return input.toLowerCase();
      case "title": return input.replace(/\b\w/g, (c) => c.toUpperCase());
      case "camel": return this.to_camel(input);
      case "snake": return this.to_snake(input);
      case "kebab": return this.to_snake(input).replace(/_/g, "-");
      case "slugify": return this.slugify(input);
      case "reverse": return [...input].reverse().join("");

      case "truncate": {
        const max = Number(params.max_length || 100);
        return input.length <= max ? input : input.slice(0, max - 3) + "...";
      }

      case "pad": {
        const ch = String(params.pad_char || " ")[0];
        const len = Number(params.pad_length || 20);
        const side = String(params.pad_side || "right");
        if (side === "left") return input.padStart(len, ch);
        if (side === "both") {
          const total = Math.max(0, len - input.length);
          const left = Math.floor(total / 2);
          return ch.repeat(left) + input + ch.repeat(total - left);
        }
        return input.padEnd(len, ch);
      }

      case "count": {
        const chars = input.length;
        const words = input.trim() ? input.trim().split(/\s+/).length : 0;
        const lines = input.split(/\r?\n/).length;
        const sentences = input.split(/[.!?]+/).filter((s) => s.trim()).length;
        return JSON.stringify({ chars, words, lines, sentences });
      }

      case "dedup": {
        const lines = input.split(/\r?\n/);
        const seen = new Set<string>();
        const unique = lines.filter((l) => { if (seen.has(l)) return false; seen.add(l); return true; });
        return unique.join("\n");
      }

      case "similarity": {
        const input2 = String(params.input2 || "");
        if (!input2) return "Error: input2 is required for similarity";
        const dist = this.levenshtein(input, input2);
        const max_len = Math.max(input.length, input2.length);
        const similarity = max_len === 0 ? 1 : 1 - dist / max_len;
        return JSON.stringify({
          levenshtein_distance: dist,
          similarity: Math.round(similarity * 10000) / 100 + "%",
          length_a: input.length,
          length_b: input2.length,
        });
      }

      case "join": {
        const sep = params.separator !== undefined ? String(params.separator) : "\n";
        const lines = input.split(/\r?\n/).filter((l) => l.trim());
        return lines.join(sep);
      }

      case "wrap": {
        const width = Number(params.width || 80);
        return this.word_wrap(input, width);
      }

      case "trim_lines":
        return input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join("\n");

      default:
        return `Error: unsupported operation "${op}"`;
    }
  }

  private to_camel(s: string): string {
    return s.replace(/[-_\s]+(.)/g, (_m, c: string) => c.toUpperCase()).replace(/^./, (c) => c.toLowerCase());
  }

  private to_snake(s: string): string {
    return s
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .replace(/[-\s]+/g, "_")
      .toLowerCase();
  }

  private slugify(s: string): string {
    return s
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  private levenshtein(a: string, b: string): number {
    if (a.length > 5000 || b.length > 5000) return Math.abs(a.length - b.length);
    const m = a.length, n = b.length;
    const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const temp = dp[j];
        dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
        prev = temp;
      }
    }
    return dp[n];
  }

  private word_wrap(text: string, width: number): string {
    return text.split(/\r?\n/).map((line) => {
      if (line.length <= width) return line;
      const words = line.split(/\s+/);
      const lines: string[] = [];
      let current = "";
      for (const word of words) {
        if (current && current.length + 1 + word.length > width) {
          lines.push(current);
          current = word;
        } else {
          current = current ? `${current} ${word}` : word;
        }
      }
      if (current) lines.push(current);
      return lines.join("\n");
    }).join("\n");
  }
}
