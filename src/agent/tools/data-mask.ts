/** DataMask 도구 — PII 마스킹/탐지/편집 (GDPR/컴플라이언스). */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

const PATTERNS: Record<string, RegExp> = {
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  phone: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g,
  card: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
  ipv4: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
};

function mask_chars(s: string, visible_start: number, visible_end: number, char = "*"): string {
  if (s.length <= visible_start + visible_end) return char.repeat(s.length);
  return s.slice(0, visible_start) + char.repeat(s.length - visible_start - visible_end) + s.slice(s.length - visible_end);
}

export class DataMaskTool extends Tool {
  readonly name = "data_mask";
  readonly category = "security" as const;
  readonly description = "PII masking: mask_email, mask_phone, mask_card, mask_ip, detect_pii, redact, custom_mask.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["mask_email", "mask_phone", "mask_card", "mask_ip", "detect_pii", "redact", "custom_mask"], description: "Operation" },
      text: { type: "string", description: "Input text" },
      pattern: { type: "string", description: "Custom regex pattern for custom_mask" },
      replacement: { type: "string", description: "Replacement string for custom_mask" },
      visible_start: { type: "integer", description: "Characters to keep visible at start" },
      visible_end: { type: "integer", description: "Characters to keep visible at end" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "detect_pii");
    const text = String(params.text || "");

    switch (action) {
      case "mask_email": {
        const masked = text.replace(PATTERNS.email, (m) => {
          const [local, domain] = m.split("@");
          return mask_chars(local, 1, 0) + "@" + domain;
        });
        return JSON.stringify({ masked, count: (text.match(PATTERNS.email) || []).length });
      }
      case "mask_phone": {
        const masked = text.replace(PATTERNS.phone, (m) => mask_chars(m.replace(/[-.\s()]/g, ""), 0, 4));
        return JSON.stringify({ masked, count: (text.match(PATTERNS.phone) || []).length });
      }
      case "mask_card": {
        const masked = text.replace(PATTERNS.card, (m) => {
          const digits = m.replace(/[-\s]/g, "");
          return mask_chars(digits, 0, 4);
        });
        return JSON.stringify({ masked, count: (text.match(PATTERNS.card) || []).length });
      }
      case "mask_ip": {
        const masked = text.replace(PATTERNS.ipv4, (m) => {
          const parts = m.split(".");
          return parts[0] + ".***.***." + parts[3];
        });
        return JSON.stringify({ masked, count: (text.match(PATTERNS.ipv4) || []).length });
      }
      case "detect_pii": {
        const findings: { type: string; count: number; matches: string[] }[] = [];
        for (const [type, re] of Object.entries(PATTERNS)) {
          const matches = text.match(new RegExp(re.source, re.flags)) || [];
          if (matches.length > 0) {
            findings.push({ type, count: matches.length, matches: matches.slice(0, 5) });
          }
        }
        return JSON.stringify({ pii_detected: findings.length > 0, findings, total: findings.reduce((s, f) => s + f.count, 0) });
      }
      case "redact": {
        let result = text;
        let total = 0;
        for (const [, re] of Object.entries(PATTERNS)) {
          const matches = result.match(new RegExp(re.source, re.flags)) || [];
          total += matches.length;
          result = result.replace(new RegExp(re.source, re.flags), "[REDACTED]");
        }
        return JSON.stringify({ redacted: result, count: total });
      }
      case "custom_mask": {
        const pattern = String(params.pattern || "");
        if (!pattern) return JSON.stringify({ error: "pattern is required" });
        const replacement = String(params.replacement || "[MASKED]");
        try {
          const re = new RegExp(pattern, "g");
          const matches = text.match(re) || [];
          const masked = text.replace(re, replacement);
          return JSON.stringify({ masked, count: matches.length });
        } catch (e) {
          return JSON.stringify({ error: `invalid pattern: ${(e as Error).message}` });
        }
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }
}
