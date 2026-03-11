/** Regex 도구 — 정규식 매칭, 치환, 추출, 분할, 테스트. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";
import { error_message } from "../../utils/common.js";

const MAX_INPUT_SIZE = 1024 * 512;
const MAX_MATCHES = 1000;

export class RegexTool extends Tool {
  readonly name = "regex";
  readonly category = "memory" as const;
  readonly description =
    "Regex operations: match, match_all, replace, extract (named groups), split, and test.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["match", "match_all", "replace", "extract", "split", "test"],
        description: "Regex operation",
      },
      input: { type: "string", description: "Input text" },
      pattern: { type: "string", description: "Regular expression pattern" },
      flags: { type: "string", description: "Regex flags (g, i, m, s, u)" },
      replacement: { type: "string", description: "Replacement string (for replace)" },
      max_results: { type: "integer", minimum: 1, maximum: 1000, description: "Max matches to return" },
    },
    required: ["operation", "input", "pattern"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const op = String(params.operation || "match");
    const input = String(params.input || "");
    const pattern = String(params.pattern || "");
    const flags = String(params.flags || "");
    const max = Math.min(MAX_MATCHES, Math.max(1, Number(params.max_results || 100)));

    if (!pattern) return "Error: pattern is required";
    if (input.length > MAX_INPUT_SIZE) return `Error: input exceeds ${MAX_INPUT_SIZE} bytes`;

    let re: RegExp;
    try {
      re = new RegExp(pattern, flags);
    } catch (err) {
      return `Error: invalid regex — ${error_message(err)}`;
    }

    switch (op) {
      case "test": return JSON.stringify({ matches: re.test(input) });
      case "match": return this.match_one(input, re);
      case "match_all": return this.match_all(input, re, flags, max);
      case "replace": return input.replace(re, String(params.replacement ?? ""));
      case "extract": return this.extract(input, re, flags, max);
      case "split": return JSON.stringify(input.split(re).slice(0, max), null, 2);
      default: return `Error: unsupported operation "${op}"`;
    }
  }

  private match_one(input: string, re: RegExp): string {
    const m = input.match(re);
    if (!m) return JSON.stringify({ found: false });
    return JSON.stringify({
      found: true,
      match: m[0],
      index: m.index,
      groups: m.groups || null,
      captures: m.slice(1),
    }, null, 2);
  }

  private match_all(input: string, re: RegExp, flags: string, max: number): string {
    const global_re = flags.includes("g") ? re : new RegExp(re.source, flags + "g");
    const matches: { match: string; index: number; groups?: Record<string, string> }[] = [];
    let m: RegExpExecArray | null;
    while ((m = global_re.exec(input)) !== null && matches.length < max) {
      matches.push({
        match: m[0],
        index: m.index,
        ...(m.groups ? { groups: m.groups } : {}),
      });
      if (!global_re.global) break;
    }
    return JSON.stringify({ count: matches.length, matches }, null, 2);
  }

  private extract(input: string, re: RegExp, flags: string, max: number): string {
    const global_re = flags.includes("g") ? re : new RegExp(re.source, flags + "g");
    const results: Record<string, string>[] = [];
    let m: RegExpExecArray | null;
    while ((m = global_re.exec(input)) !== null && results.length < max) {
      if (m.groups && Object.keys(m.groups).length > 0) {
        results.push({ ...m.groups });
      } else if (m.length > 1) {
        const obj: Record<string, string> = {};
        m.slice(1).forEach((v, i) => { obj[`group_${i + 1}`] = v ?? ""; });
        results.push(obj);
      }
      if (!global_re.global) break;
    }
    return JSON.stringify({ count: results.length, extracted: results }, null, 2);
  }
}
