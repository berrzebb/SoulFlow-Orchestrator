/** Email Validate 도구 — 이메일 주소 검증/파싱/정규화. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "tempmail.com", "throwaway.email",
  "yopmail.com", "sharklasers.com", "guerrillamailblock.com", "grr.la",
  "dispostable.com", "mailnesia.com", "maildrop.cc", "10minutemail.com",
]);

const FREE_PROVIDERS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com",
  "aol.com", "icloud.com", "mail.com", "protonmail.com", "zoho.com",
  "yandex.com", "naver.com", "daum.net", "hanmail.net", "kakao.com",
]);

export class EmailValidateTool extends Tool {
  readonly name = "email_validate";
  readonly category = "data" as const;
  readonly description = "Email validation utilities: validate, parse, normalize, check_disposable, check_free, bulk_validate.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["validate", "parse", "normalize", "check_disposable", "check_free", "bulk_validate"], description: "Operation" },
      email: { type: "string", description: "Email address" },
      emails: { type: "string", description: "JSON array of emails (bulk_validate)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "validate");

    switch (action) {
      case "validate": {
        const email = String(params.email || "");
        return JSON.stringify(this.validate_email(email));
      }
      case "parse": {
        const email = String(params.email || "");
        const at = email.lastIndexOf("@");
        if (at < 0) return JSON.stringify({ error: "invalid email: no @ sign" });
        const local = email.slice(0, at);
        const domain = email.slice(at + 1).toLowerCase();
        const plus = local.indexOf("+");
        return JSON.stringify({
          local,
          domain,
          base_local: plus >= 0 ? local.slice(0, plus) : local,
          tag: plus >= 0 ? local.slice(plus + 1) : null,
          is_free: FREE_PROVIDERS.has(domain),
          is_disposable: DISPOSABLE_DOMAINS.has(domain),
        });
      }
      case "normalize": {
        const email = String(params.email || "").trim().toLowerCase();
        const at = email.lastIndexOf("@");
        if (at < 0) return JSON.stringify({ error: "invalid email" });
        let local = email.slice(0, at);
        const domain = email.slice(at + 1);
        // Gmail: remove dots and plus tags
        if (domain === "gmail.com") {
          const plus = local.indexOf("+");
          if (plus >= 0) local = local.slice(0, plus);
          local = local.replace(/\./g, "");
        }
        return JSON.stringify({ original: params.email, normalized: `${local}@${domain}` });
      }
      case "check_disposable": {
        const email = String(params.email || "");
        const domain = email.split("@")[1]?.toLowerCase() || "";
        return JSON.stringify({ email, domain, is_disposable: DISPOSABLE_DOMAINS.has(domain) });
      }
      case "check_free": {
        const email = String(params.email || "");
        const domain = email.split("@")[1]?.toLowerCase() || "";
        return JSON.stringify({ email, domain, is_free: FREE_PROVIDERS.has(domain) });
      }
      case "bulk_validate": {
        let emails: string[];
        try { emails = JSON.parse(String(params.emails || "[]")); } catch { return JSON.stringify({ error: "invalid emails JSON" }); }
        const results = emails.map((e) => ({ email: e, ...this.validate_email(e) }));
        const valid_count = results.filter((r) => r.valid).length;
        return JSON.stringify({ total: emails.length, valid: valid_count, invalid: emails.length - valid_count, results });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private validate_email(email: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!email) { errors.push("empty email"); return { valid: false, errors }; }
    const at = email.lastIndexOf("@");
    if (at < 0) { errors.push("missing @"); return { valid: false, errors }; }
    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    if (!local) errors.push("empty local part");
    if (local.length > 64) errors.push("local part too long (max 64)");
    if (!domain) errors.push("empty domain");
    if (domain.length > 253) errors.push("domain too long (max 253)");
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(domain)) errors.push("invalid domain format");
    if (!domain.includes(".")) errors.push("domain missing TLD");
    if (/^[.]|[.]$/.test(local)) errors.push("local part starts/ends with dot");
    if (/\.\./.test(local)) errors.push("consecutive dots in local part");
    return { valid: errors.length === 0, errors };
  }
}
