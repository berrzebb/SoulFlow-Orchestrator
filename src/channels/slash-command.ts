import type { InboundMessage } from "../bus/types.js";
import type { ChannelCommand } from "./types.js";

export type ParsedSlashCommand = ChannelCommand & {
  args_lower: string[];
};

function clean_token(value: unknown): string {
  return String(value || "").trim();
}

export function normalize_slash_token(value: unknown): string {
  return clean_token(value).toLowerCase();
}

export function normalize_slash_name(value: unknown): string {
  const raw = clean_token(value).replace(/^\/+/, "");
  if (!raw) return "";
  const without_bot_suffix = raw.split("@")[0] || raw;
  return without_bot_suffix.trim().toLowerCase();
}

function clean_args(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => clean_token(v)).filter(Boolean);
}

export function parse_slash_command(content: string): ChannelCommand | null {
  const raw = clean_token(content);
  if (!raw.startsWith("/")) return null;
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const name = normalize_slash_name(parts[0]);
  if (!name) return null;
  return {
    raw,
    name,
    args: parts.slice(1).map((v) => clean_token(v)).filter(Boolean),
  };
}

export function parse_slash_command_from_message(message: InboundMessage): ParsedSlashCommand | null {
  const meta = (message.metadata || {}) as Record<string, unknown>;
  const raw_command = (meta.command && typeof meta.command === "object")
    ? (meta.command as Record<string, unknown>)
    : null;
  if (raw_command) {
    const name = normalize_slash_name(raw_command.name);
    if (!name) return null;
    const args = clean_args(raw_command.args);
    return {
      raw: clean_token(raw_command.raw || message.content),
      name,
      args,
      args_lower: args.map((v) => normalize_slash_token(v)),
    };
  }
  const parsed = parse_slash_command(String(message.content || ""));
  if (!parsed) return null;
  return {
    ...parsed,
    args_lower: parsed.args.map((v) => normalize_slash_token(v)),
  };
}

export function slash_token_in(value: unknown, aliases: readonly string[]): boolean {
  const token = normalize_slash_token(value);
  if (!token) return false;
  for (const alias of aliases) {
    if (token === normalize_slash_token(alias)) return true;
  }
  return false;
}

export function slash_name_in(value: unknown, aliases: readonly string[]): boolean {
  const token = normalize_slash_name(value);
  if (!token) return false;
  for (const alias of aliases) {
    if (token === normalize_slash_name(alias)) return true;
  }
  return false;
}

