/** Password 도구 — 비밀번호 강도/정책/해싱/생성. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";

export class PasswordTool extends Tool {
  readonly name = "password";
  readonly category = "data" as const;
  readonly description = "Password utilities: strength, check_policy, hash, verify, generate, entropy.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["strength", "check_policy", "hash", "verify", "generate", "entropy"], description: "Operation" },
      password: { type: "string", description: "Password to analyze" },
      hashed: { type: "string", description: "Hashed password (verify)" },
      min_length: { type: "number", description: "Minimum length (check_policy, default: 8)" },
      require_upper: { type: "boolean", description: "Require uppercase (default: true)" },
      require_lower: { type: "boolean", description: "Require lowercase (default: true)" },
      require_digit: { type: "boolean", description: "Require digit (default: true)" },
      require_special: { type: "boolean", description: "Require special char (default: false)" },
      length: { type: "number", description: "Generated password length (default: 16)" },
      charset: { type: "string", description: "Character set for generate (alpha/alnum/all, default: all)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "strength");

    switch (action) {
      case "strength": {
        const pw = String(params.password || "");
        return JSON.stringify(this.analyze_strength(pw));
      }
      case "check_policy": {
        const pw = String(params.password || "");
        const min_len = Number(params.min_length) || 8;
        const req_upper = params.require_upper !== false;
        const req_lower = params.require_lower !== false;
        const req_digit = params.require_digit !== false;
        const req_special = Boolean(params.require_special);
        const errors: string[] = [];
        if (pw.length < min_len) errors.push(`too short (min ${min_len})`);
        if (req_upper && !/[A-Z]/.test(pw)) errors.push("missing uppercase letter");
        if (req_lower && !/[a-z]/.test(pw)) errors.push("missing lowercase letter");
        if (req_digit && !/\d/.test(pw)) errors.push("missing digit");
        if (req_special && !/[^A-Za-z0-9]/.test(pw)) errors.push("missing special character");
        if (/(.)\1{2,}/.test(pw)) errors.push("repeated characters detected");
        if (/^(012|123|234|345|456|567|678|789|abc|bcd|cde|def)/i.test(pw)) errors.push("sequential pattern detected");
        return JSON.stringify({ valid: errors.length === 0, errors });
      }
      case "hash": {
        const pw = String(params.password || "");
        const salt = randomBytes(16);
        const derived = await new Promise<Buffer>((resolve, reject) => {
          scrypt(pw, salt, 64, (err, key) => err ? reject(err) : resolve(key));
        });
        const hash = `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
        return JSON.stringify({ hash });
      }
      case "verify": {
        const pw = String(params.password || "");
        const hashed = String(params.hashed || "");
        const parts = hashed.split(":");
        if (parts.length !== 3 || parts[0] !== "scrypt") {
          return JSON.stringify({ match: false, error: "invalid hash format (expected scrypt:salt:key)" });
        }
        const salt = Buffer.from(parts[1], "hex");
        const expected = Buffer.from(parts[2], "hex");
        const derived = await new Promise<Buffer>((resolve, reject) => {
          scrypt(pw, salt, 64, (err, key) => err ? reject(err) : resolve(key));
        });
        const match = derived.length === expected.length && timingSafeEqual(derived, expected);
        return JSON.stringify({ match });
      }
      case "generate": {
        const len = Number(params.length) || 16;
        const charset_type = String(params.charset || "all");
        let chars: string;
        switch (charset_type) {
          case "alpha": chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"; break;
          case "alnum": chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"; break;
          default: chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+"; break;
        }
        const bytes = randomBytes(len);
        let pw = "";
        for (let i = 0; i < len; i++) pw += chars[bytes[i] % chars.length];
        const analysis = this.analyze_strength(pw);
        return JSON.stringify({ password: pw, ...analysis });
      }
      case "entropy": {
        const pw = String(params.password || "");
        let pool = 0;
        if (/[a-z]/.test(pw)) pool += 26;
        if (/[A-Z]/.test(pw)) pool += 26;
        if (/\d/.test(pw)) pool += 10;
        if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
        const entropy = pw.length * Math.log2(pool || 1);
        return JSON.stringify({ length: pw.length, pool_size: pool, entropy_bits: Math.round(entropy * 100) / 100 });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private analyze_strength(pw: string): Record<string, unknown> {
    let pool = 0;
    if (/[a-z]/.test(pw)) pool += 26;
    if (/[A-Z]/.test(pw)) pool += 26;
    if (/\d/.test(pw)) pool += 10;
    if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
    const entropy = pw.length * Math.log2(pool || 1);
    const has_upper = /[A-Z]/.test(pw);
    const has_lower = /[a-z]/.test(pw);
    const has_digit = /\d/.test(pw);
    const has_special = /[^A-Za-z0-9]/.test(pw);
    const variety = [has_upper, has_lower, has_digit, has_special].filter(Boolean).length;

    let score: string;
    if (entropy < 28) score = "very_weak";
    else if (entropy < 36) score = "weak";
    else if (entropy < 60) score = "fair";
    else if (entropy < 80) score = "strong";
    else score = "very_strong";

    const warnings: string[] = [];
    if (pw.length < 8) warnings.push("too short");
    if (/(.)\1{2,}/.test(pw)) warnings.push("repeated characters");
    if (/^(password|123456|qwerty|admin|letmein)/i.test(pw)) warnings.push("common password");
    if (variety < 2) warnings.push("low character variety");

    return { length: pw.length, entropy_bits: Math.round(entropy * 100) / 100, score, variety, has_upper, has_lower, has_digit, has_special, warnings };
  }
}
