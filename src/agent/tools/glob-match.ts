/** Glob Match 도구 — glob 패턴 매칭/테스트/필터링. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class GlobMatchTool extends Tool {
  readonly name = "glob_match";
  readonly category = "data" as const;
  readonly description = "Glob pattern matching: test, filter, extract, expand, parse.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["test", "filter", "extract", "parse", "to_regex"], description: "Operation" },
      pattern: { type: "string", description: "Glob pattern" },
      input: { type: "string", description: "String to test" },
      inputs: { type: "string", description: "JSON array of strings (filter)" },
      negate: { type: "boolean", description: "Negate the match" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "test");
    const pattern = String(params.pattern || "*");

    switch (action) {
      case "test": {
        const input = String(params.input || "");
        const re = this.glob_to_regex(pattern);
        const match = re.test(input);
        return JSON.stringify({ pattern, input, match: params.negate ? !match : match });
      }
      case "filter": {
        let inputs: string[];
        try { inputs = JSON.parse(String(params.inputs || "[]")); } catch { return JSON.stringify({ error: "invalid inputs JSON" }); }
        const re = this.glob_to_regex(pattern);
        const negate = Boolean(params.negate);
        const matched = inputs.filter((s) => negate ? !re.test(s) : re.test(s));
        return JSON.stringify({ pattern, total: inputs.length, matched_count: matched.length, matched });
      }
      case "extract": {
        const input = String(params.input || "");
        const re = this.glob_to_regex(pattern);
        const m = re.exec(input);
        return JSON.stringify({ pattern, input, match: !!m, groups: m ? m.slice(1) : [] });
      }
      case "parse": {
        const parts = this.parse_glob(pattern);
        return JSON.stringify({ pattern, parts, has_globstar: pattern.includes("**"), has_wildcard: pattern.includes("*"), has_question: pattern.includes("?") });
      }
      case "to_regex": {
        const re = this.glob_to_regex(pattern);
        return JSON.stringify({ pattern, regex: re.source, flags: re.flags });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private glob_to_regex(pattern: string): RegExp {
    let re = "";
    let i = 0;
    const len = pattern.length;
    while (i < len) {
      const ch = pattern[i];
      switch (ch) {
        case "*":
          if (pattern[i + 1] === "*") {
            if (pattern[i + 2] === "/") { re += "(?:.+/)?"; i += 3; }
            else { re += ".*"; i += 2; }
          } else { re += "[^/]*"; i++; }
          break;
        case "?": re += "[^/]"; i++; break;
        case "[": {
          let j = i + 1;
          let neg = false;
          if (pattern[j] === "!" || pattern[j] === "^") { neg = true; j++; }
          let bracket = neg ? "[^" : "[";
          while (j < len && pattern[j] !== "]") {
            if (pattern[j] === "\\") { bracket += "\\" + (pattern[j + 1] || ""); j += 2; }
            else { bracket += pattern[j]; j++; }
          }
          bracket += "]";
          re += bracket;
          i = j + 1;
          break;
        }
        case "{": {
          const close = pattern.indexOf("}", i);
          if (close > i) {
            const alts = pattern.slice(i + 1, close).split(",").map((s) => this.escape_re(s.trim()));
            re += `(?:${alts.join("|")})`;
            i = close + 1;
          } else { re += "\\{"; i++; }
          break;
        }
        case ".": case "+": case "^": case "$": case "|":
        case "(": case ")": case "\\":
          re += "\\" + ch; i++; break;
        default: re += ch; i++; break;
      }
    }
    return new RegExp(`^${re}$`);
  }

  private escape_re(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private parse_glob(pattern: string): { type: string; value: string }[] {
    const parts: { type: string; value: string }[] = [];
    let literal = "";
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      if (ch === "*" || ch === "?" || ch === "[" || ch === "{") {
        if (literal) { parts.push({ type: "literal", value: literal }); literal = ""; }
        if (ch === "*" && pattern[i + 1] === "*") { parts.push({ type: "globstar", value: "**" }); i++; if (pattern[i + 1] === "/") i++; }
        else if (ch === "*") parts.push({ type: "wildcard", value: "*" });
        else if (ch === "?") parts.push({ type: "any_char", value: "?" });
        else {
          const close = pattern.indexOf(ch === "[" ? "]" : "}", i);
          if (close > i) { parts.push({ type: ch === "[" ? "class" : "alternatives", value: pattern.slice(i, close + 1) }); i = close; }
          else { literal += ch; }
        }
      } else { literal += ch; }
    }
    if (literal) parts.push({ type: "literal", value: literal });
    return parts;
  }
}
