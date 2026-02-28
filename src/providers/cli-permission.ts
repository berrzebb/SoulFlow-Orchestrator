import { resolve } from "node:path";
import type { ChatOptions } from "./types.js";
import {
  build_codex_mcp_overrides,
  load_mcp_servers_for_codex,
  parse_bool_like,
  runtime_mcp_allowlist,
  should_enable_all_project_mcp_servers,
} from "./cli-mcp-loader.js";

export function split_args(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function strip_surrounding_quotes(v: string): string {
  const s = String(v || "").trim();
  if ((s.startsWith("\"") && s.endsWith("\"")) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).trim();
  }
  return s;
}

export function split_command_with_embedded_args(raw: string): { command: string; args: string[] } {
  const text = String(raw || "").trim();
  if (!text) return { command: "", args: [] };

  const quoted = text.match(/^"([^"]+)"(?:\s+([\s\S]*))?$/) || text.match(/^'([^']+)'(?:\s+([\s\S]*))?$/);
  if (quoted) {
    const command = String(quoted[1] || "").trim();
    const rest = String(quoted[2] || "").trim();
    return { command, args: rest ? split_args(rest) : [] };
  }

  const parts = split_args(text);
  if (parts.length <= 1) return { command: text, args: [] };
  return { command: parts[0], args: parts.slice(1) };
}

export function strip_approval_flags(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || "").trim();
    if (!token) continue;
    const low = token.toLowerCase();
    if (low.startsWith("--ask-for-approval=")) continue;
    if (low === "-a" || low === "--ask-for-approval") {
      const next = String(args[i + 1] || "").trim();
      if (next && !next.startsWith("-")) i += 1;
      continue;
    }
    out.push(token);
  }
  return out;
}

function normalize_permission_profile(raw: unknown): "strict" | "workspace-write" | "full-auto" | null {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "strict") return "strict";
  if (v === "workspace-write" || v === "workspace_write") return "workspace-write";
  if (v === "full-auto" || v === "full_auto" || v === "bypass") return "full-auto";
  return null;
}

function command_basename(command: string): string {
  const raw = strip_surrounding_quotes(String(command || "").trim()).toLowerCase();
  if (!raw) return "";
  const idx = Math.max(raw.lastIndexOf("/"), raw.lastIndexOf("\\"));
  return idx >= 0 ? raw.slice(idx + 1) : raw;
}

export function is_codex_command(command: string): boolean {
  const base = command_basename(command);
  return base === "codex" || base === "codex.exe" || base === "codex.cmd" || base === "codex.ps1";
}

export function is_claude_command(command: string): boolean {
  const base = command_basename(command);
  return base === "claude" || base === "claude.exe" || base === "claude.cmd";
}

function first_non_flag_index(args: string[]): number {
  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || "").trim();
    if (!token) continue;
    if (!token.startsWith("-")) return i;
  }
  return -1;
}

function first_non_flag_token(args: string[]): string {
  const idx = first_non_flag_index(args);
  if (idx < 0) return "";
  return String(args[idx] || "").trim();
}

function is_codex_invocation(command: string, args: string[]): boolean {
  if (is_codex_command(command)) return true;
  return is_codex_command(first_non_flag_token(args));
}

function is_claude_invocation(command: string, args: string[]): boolean {
  if (is_claude_command(command)) return true;
  return is_claude_command(first_non_flag_token(args));
}

function has_any_flag(args: string[], flags: string[]): boolean {
  const set = new Set(flags.map((f) => String(f || "").trim().toLowerCase()));
  for (const token of args) {
    const normalized = String(token || "").trim().toLowerCase();
    if (!normalized) continue;
    if (set.has(normalized)) return true;
    const eq_idx = normalized.indexOf("=");
    if (eq_idx > 0) {
      const head = normalized.slice(0, eq_idx);
      if (set.has(head)) return true;
    }
  }
  return false;
}

function with_codex_global_option(args: string[], flag: string, value?: string): string[] {
  const out = [...args];
  const first_non_flag = first_non_flag_index(out);
  const insert_at = first_non_flag >= 0 ? first_non_flag : out.length;
  if (value === undefined) {
    out.splice(insert_at, 0, flag);
  } else {
    out.splice(insert_at, 0, flag, value);
  }
  return out;
}

function split_path_list(raw: string): string[] {
  const text = String(raw || "").trim();
  if (!text) return [];
  const sep = text.includes(";") ? ";" : ",";
  return text
    .split(sep)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function with_codex_permission_overrides(
  command: string,
  args: string[],
  runtime_policy?: ChatOptions["runtime_policy"],
): string[] {
  if (!is_codex_invocation(command, args)) return args;
  let out = strip_approval_flags(args);
  if (has_any_flag(out, ["--dangerously-bypass-approvals-and-sandbox"])) return out;
  const command_profile = String(runtime_policy?.command_profile || "").trim().toLowerCase();
  const requested_profile = normalize_permission_profile(runtime_policy?.permission_profile);
  const profile = requested_profile
    || (command_profile === "safe" ? "strict" : command_profile === "extended" ? "full-auto" : null);
  const bypass_all = profile === "full-auto"
    ? true
    : parse_bool_like(process.env.ORCH_CODEX_BYPASS_SANDBOX, false);
  if (bypass_all) {
    if (!has_any_flag(out, ["--dangerously-bypass-approvals-and-sandbox"])) {
      out = with_codex_global_option(out, "--dangerously-bypass-approvals-and-sandbox");
    }
    return out;
  }

  const sandbox_mode = profile === "strict"
    ? "read-only"
    : profile === "workspace-write"
      ? "workspace-write"
      : String(process.env.ORCH_CODEX_SANDBOX_MODE || "workspace-write").trim();
  const has_sandbox = has_any_flag(out, ["-s", "--sandbox", "--full-auto"]);

  if (sandbox_mode && !has_sandbox) {
    out = with_codex_global_option(out, "--sandbox", sandbox_mode);
  }

  const add_dirs = split_path_list(String(process.env.ORCH_CODEX_ADD_DIRS || ""))
    .map((d) => resolve(String(process.env.WORKSPACE_DIR || process.cwd()), d));
  const existing_dirs = new Set<string>();
  for (let i = 0; i < out.length; i += 1) {
    const token = String(out[i] || "").trim().toLowerCase();
    if (token !== "--add-dir") continue;
    const dir = String(out[i + 1] || "").trim();
    if (!dir) continue;
    existing_dirs.add(resolve(dir).toLowerCase());
  }
  for (const dir of add_dirs) {
    const key = resolve(dir).toLowerCase();
    if (existing_dirs.has(key)) continue;
    out = with_codex_global_option(out, "--add-dir", dir);
    existing_dirs.add(key);
  }

  return out;
}

export function with_claude_permission_overrides(
  command: string,
  args: string[],
  runtime_policy?: ChatOptions["runtime_policy"],
): string[] {
  if (!is_claude_invocation(command, args)) return args;
  const out = [...args];
  const command_profile = String(runtime_policy?.command_profile || "").trim().toLowerCase();
  const requested_profile = normalize_permission_profile(runtime_policy?.permission_profile);
  const profile = requested_profile
    || (command_profile === "safe" ? "strict" : command_profile === "extended" ? "full-auto" : null);
  const mode = profile === "strict"
    ? "default"
    : String(process.env.ORCH_CLAUDE_PERMISSION_MODE || "dontAsk").trim();
  if (!mode) return out;
  if (!has_any_flag(out, ["--permission-mode"])) {
    out.push("--permission-mode", mode);
  }
  return out;
}

export function with_codex_mcp_runtime_overrides(
  command: string,
  args: string[],
  runtime_policy?: ChatOptions["runtime_policy"],
): string[] {
  const enabled = String(process.env.ORCH_MCP_ENABLED || "1").trim() !== "0";
  if (!enabled) return args;
  if (!is_codex_invocation(command, args)) return args;
  if (args.some((v) => /mcp_servers\./i.test(String(v || "")))) return args;
  const cwd = resolve(String(process.env.WORKSPACE_DIR || process.cwd()));
  const runtime_allow = runtime_mcp_allowlist(runtime_policy?.mcp_servers);
  const enable_all_project = typeof runtime_policy?.mcp_enable_all_project === "boolean"
    ? runtime_policy.mcp_enable_all_project
    : should_enable_all_project_mcp_servers(cwd);
  const servers = load_mcp_servers_for_codex(cwd, runtime_allow);
  const overrides = build_codex_mcp_overrides(servers);
  if (!enable_all_project && overrides.length === 0) return args;
  let out = [...args];
  if (enable_all_project) {
    out = with_codex_global_option(out, "-c", "enable_all_project_mcp_servers=true");
  }
  for (const override of overrides) {
    out = with_codex_global_option(out, "-c", override);
  }
  return out;
}
