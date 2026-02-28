import { escape_regexp } from "../utils/common.js";

const REDACTED = "[REDACTED]";
const SECRET_KEYWORDS = [
  "token",
  "api_key",
  "apikey",
  "secret",
  "client_secret",
  "password",
  "passwd",
  "access_key",
  "refresh_token",
] as const;

const DIRECT_PATTERNS: Array<{ name: string; re: RegExp }> = [
  {
    name: "private_key_block",
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi,
  },
  {
    name: "jwt",
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,}\b/g,
  },
  {
    name: "openai_key",
    re: /\bsk-[A-Za-z0-9]{20,}\b/g,
  },
  {
    name: "anthropic_key",
    re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: "github_pat",
    re: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  },
  {
    name: "slack_token",
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    name: "aws_access_key",
    re: /\b(A3T[A-Z0-9]|AKIA|ASIA)[A-Z0-9]{12,}\b/g,
  },
  {
    name: "bearer_token",
    re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi,
  },
  {
    name: "basic_token",
    re: /\bBasic\s+[A-Za-z0-9+/=]{16,}\b/gi,
  },
];

const ASSIGNMENT_RE = /\b([A-Za-z0-9_.-]{2,64})\s*[:=]\s*([^\s"'`]{6,}|["'][^"']{6,}["'])/g;

function keyword_is_sensitive(name: string): boolean {
  const key = String(name || "").trim().toLowerCase();
  if (!key) return false;
  return SECRET_KEYWORDS.some((token) => key.includes(token));
}

function mask_assignment(match: string, keyRaw: string): string {
  const key = String(keyRaw || "").trim();
  if (!key) return REDACTED;
  return `${key}=${REDACTED}`;
}

function redact_env_style_tokens(text: string): string {
  return String(text || "").replace(ASSIGNMENT_RE, (m, keyRaw) => {
    if (!keyword_is_sensitive(String(keyRaw || ""))) return m;
    return mask_assignment(m, String(keyRaw || ""));
  });
}

function collect_env_secret_values(): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (!keyword_is_sensitive(key)) continue;
    const token = String(value || "").trim();
    if (token.length < 6) continue;
    out.push(token);
  }
  return [...new Set(out)];
}

function mask_exact_values(input: string, values: string[]): string {
  let out = String(input || "");
  for (const raw of values) {
    const value = String(raw || "");
    if (!value || value.length < 6) continue;
    const re = new RegExp(escape_regexp(value), "g");
    out = out.replace(re, REDACTED);
  }
  return out;
}

export type RedactionResult = {
  text: string;
  redacted: boolean;
  match_count: number;
};

export function redact_sensitive_text(input: string): RedactionResult {
  let text = String(input || "");
  if (!text) return { text: "", redacted: false, match_count: 0 };
  const before = text;
  let count = 0;

  for (const pattern of DIRECT_PATTERNS) {
    text = text.replace(pattern.re, () => {
      count += 1;
      return REDACTED;
    });
  }

  const assigned = redact_env_style_tokens(text);
  if (assigned !== text) {
    text = assigned;
    count += 1;
  }

  const envMasked = mask_exact_values(text, collect_env_secret_values());
  if (envMasked !== text) {
    text = envMasked;
    count += 1;
  }

  return {
    text,
    redacted: text !== before,
    match_count: count,
  };
}

export function redact_sensitive_unknown(value: unknown): unknown {
  if (typeof value === "string") return redact_sensitive_text(value).text;
  if (Array.isArray(value)) return value.map((item) => redact_sensitive_unknown(item));
  if (!value || typeof value !== "object") return value;
  const rec = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (keyword_is_sensitive(k)) {
      out[k] = REDACTED;
      continue;
    }
    out[k] = redact_sensitive_unknown(v);
  }
  return out;
}

export function redact_for_log(value: unknown): string {
  if (typeof value === "string") return redact_sensitive_text(value).text;
  try {
    return JSON.stringify(redact_sensitive_unknown(value));
  } catch {
    return REDACTED;
  }
}

