import { createHash } from "node:crypto";
import type { SecretVaultLike } from "./secret-vault.js";

export type SensitiveKind =
  | "password"
  | "token"
  | "card"
  | "account"
  | "private_key"
  | "secret";

export type SensitiveSealHit = {
  key: string;
  kind: SensitiveKind;
  placeholder: string;
};

export type SensitiveSealResult = {
  text: string;
  hits: SensitiveSealHit[];
};

const PRIVATE_KEY_BLOCK_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi;
const ASSIGNMENT_RE = /\b([A-Za-z0-9_.-]{2,80})\s*([:=])\s*("[^"\n]{1,400}"|'[^'\n]{1,400}'|[^\s,;]{4,400})/g;
const CARD_ASSIGNMENT_RE = /\b(card|card_number|credit_card|카드(?:번호)?)\s*([:=])\s*([0-9][0-9 -]{11,30}[0-9])\b/gi;
const ACCOUNT_ASSIGNMENT_RE = /\b(account|acct|iban|routing|bank_account|계좌(?:번호)?)\s*([:=])\s*([0-9][0-9 -]{6,40}[0-9])\b/gi;
const ACCOUNT_LINE_RE = /\b(?:account|acct|iban|routing|bank|계좌(?:번호)?)\s*[:=]?\s*([0-9][0-9 -]{6,29}[0-9])\b/gi;
const CARD_NUMBER_RE = /\b\d(?:[ -]?\d){12,18}\b/g;

const TOKEN_PATTERNS: Array<{ kind: SensitiveKind; re: RegExp }> = [
  { kind: "token", re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { kind: "token", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { kind: "token", re: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { kind: "token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "token", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi },
  { kind: "token", re: /\bBasic\s+[A-Za-z0-9+/=]{16,}\b/gi },
  { kind: "token", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,}\b/g },
];

const SENSITIVE_KEYWORDS: Array<{ token: string; kind: SensitiveKind }> = [
  { token: "password", kind: "password" },
  { token: "passwd", kind: "password" },
  { token: "pass", kind: "password" },
  { token: "pw", kind: "password" },
  { token: "pin", kind: "password" },
  { token: "token", kind: "token" },
  { token: "api_key", kind: "token" },
  { token: "apikey", kind: "token" },
  { token: "secret", kind: "secret" },
  { token: "card", kind: "card" },
  { token: "account", kind: "account" },
  { token: "acct", kind: "account" },
  { token: "iban", kind: "account" },
  { token: "routing", kind: "account" },
  { token: "계좌", kind: "account" },
  { token: "카드", kind: "card" },
  { token: "비밀번호", kind: "password" },
];

type SealContext = {
  provider: string;
  chat_id: string;
  vault: SecretVaultLike;
};

function normalize_part(value: string, fallback: string): string {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "");
  return raw || fallback;
}

function hash_short(value: string, size = 12): string {
  return createHash("sha256")
    .update(String(value || ""), "utf-8")
    .digest("hex")
    .slice(0, Math.max(4, size));
}

function unwrap_quoted(value: string): { quote: "\"" | "'" | ""; inner: string } {
  const text = String(value || "");
  if (text.length >= 2 && text.startsWith("\"") && text.endsWith("\"")) {
    return { quote: "\"", inner: text.slice(1, -1) };
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return { quote: "'", inner: text.slice(1, -1) };
  }
  return { quote: "", inner: text };
}

function keyword_kind(keyRaw: string): SensitiveKind | null {
  const key = String(keyRaw || "").trim().toLowerCase();
  if (!key) return null;
  for (const row of SENSITIVE_KEYWORDS) {
    if (key.includes(row.token)) return row.kind;
  }
  return null;
}

function normalize_digits(value: string): string {
  return String(value || "").replace(/[^0-9]/g, "");
}

function luhn_valid(raw: string): boolean {
  const digits = normalize_digits(raw);
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double_next = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i] || "0");
    if (double_next) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double_next = !double_next;
  }
  return sum % 10 === 0;
}

async function replace_async(
  input: string,
  re: RegExp,
  mapper: (match: RegExpExecArray) => Promise<string>,
): Promise<string> {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const global = new RegExp(re.source, flags);
  let out = "";
  let last = 0;
  while (true) {
    const m = global.exec(input);
    if (!m) break;
    out += input.slice(last, m.index);
    out += await mapper(m);
    last = m.index + m[0].length;
    if (m[0].length <= 0) global.lastIndex += 1;
  }
  out += input.slice(last);
  return out;
}

function build_secret_key(provider: string, chat_id: string, kind: SensitiveKind, value: string): string {
  const provider_key = normalize_part(provider, "channel");
  const chat_hash = hash_short(chat_id, 10);
  const value_hash = hash_short(value, 16);
  return `inbound.${provider_key}.c${chat_hash}.${kind}.v${value_hash}`;
}

function as_placeholder(secret_name: string): string {
  return `{{secret:${secret_name}}}`;
}

async function seal_value(value: string, kind: SensitiveKind, ctx: SealContext, hits: Map<string, SensitiveSealHit>): Promise<string> {
  const plain = String(value || "");
  if (plain.trim().length < 4) return plain;
  const key = build_secret_key(ctx.provider, ctx.chat_id, kind, plain);
  await ctx.vault.put_secret(key, plain);
  if (!hits.has(key)) {
    hits.set(key, {
      key,
      kind,
      placeholder: as_placeholder(key),
    });
  }
  return as_placeholder(key);
}

export async function seal_inbound_sensitive_text(
  input: string,
  args: {
    provider: string;
    chat_id: string;
    vault: SecretVaultLike;
  },
): Promise<SensitiveSealResult> {
  const ctx: SealContext = {
    provider: String(args.provider || ""),
    chat_id: String(args.chat_id || ""),
    vault: args.vault,
  };
  const hits = new Map<string, SensitiveSealHit>();
  let out = String(input || "");
  if (!out.trim()) return { text: out, hits: [] };

  out = await replace_async(out, PRIVATE_KEY_BLOCK_RE, async (m) => {
    return seal_value(String(m[0] || ""), "private_key", ctx, hits);
  });

  out = await replace_async(out, CARD_ASSIGNMENT_RE, async (m) => {
    const key = String(m[1] || "");
    const separator = String(m[2] || "=");
    const value_raw = String(m[3] || "");
    const sealed = await seal_value(value_raw, "card", ctx, hits);
    return `${key}${separator}${sealed}`;
  });

  out = await replace_async(out, ACCOUNT_ASSIGNMENT_RE, async (m) => {
    const key = String(m[1] || "");
    const separator = String(m[2] || "=");
    const value_raw = String(m[3] || "");
    const sealed = await seal_value(value_raw, "account", ctx, hits);
    return `${key}${separator}${sealed}`;
  });

  out = await replace_async(out, ASSIGNMENT_RE, async (m) => {
    const key = String(m[1] || "");
    const separator = String(m[2] || "=");
    const value_raw = String(m[3] || "");
    const kind = keyword_kind(key);
    if (!kind) return String(m[0] || "");
    if (kind === "card" || kind === "account") return String(m[0] || "");
    const unwrapped = unwrap_quoted(value_raw);
    const sealed = await seal_value(unwrapped.inner, kind, ctx, hits);
    const value_with_quote = unwrapped.quote ? `${unwrapped.quote}${sealed}${unwrapped.quote}` : sealed;
    return `${key}${separator}${value_with_quote}`;
  });

  out = await replace_async(out, ACCOUNT_LINE_RE, async (m) => {
    const full = String(m[0] || "");
    const raw_number = String(m[1] || "");
    if (!raw_number) return full;
    const sealed = await seal_value(raw_number, "account", ctx, hits);
    return full.replace(raw_number, sealed);
  });

  out = await replace_async(out, CARD_NUMBER_RE, async (m) => {
    const candidate = String(m[0] || "");
    if (!luhn_valid(candidate)) return candidate;
    return seal_value(candidate, "card", ctx, hits);
  });

  for (const row of TOKEN_PATTERNS) {
    out = await replace_async(out, row.re, async (m) => seal_value(String(m[0] || ""), row.kind, ctx, hits));
  }

  return {
    text: out,
    hits: [...hits.values()],
  };
}
