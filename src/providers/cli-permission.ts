import { resolve } from "node:path";
import type { ChatOptions, FsAccessLevel } from "./types.js";
import { sandbox_from_preset } from "./types.js";
import {
  build_codex_mcp_overrides,
  load_mcp_servers_for_codex,
  runtime_mcp_allowlist,
  should_enable_all_project_mcp_servers,
} from "./cli-mcp-loader.js";

export type CliPermissionConfig = {
  workspace_dir?: string;
  codex_bypass_sandbox?: boolean;
  codex_sandbox_mode?: string;
  codex_add_dirs?: string;
  claude_permission_mode?: string;
  gemini_approval_mode?: string;
  mcp_enabled?: boolean;
};

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

export function is_gemini_command(command: string): boolean {
  const base = command_basename(command);
  return base === "gemini" || base === "gemini.exe" || base === "gemini.cmd";
}

function is_gemini_invocation(command: string, args: string[]): boolean {
  if (is_gemini_command(command)) return true;
  return is_gemini_command(first_non_flag_token(args));
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
  config?: CliPermissionConfig,
): string[] {
  if (!is_codex_invocation(command, args)) return args;
  let out = strip_approval_flags(args);
  if (has_any_flag(out, ["--dangerously-bypass-approvals-and-sandbox"])) return out;

  const sandbox = runtime_policy?.sandbox ?? sandbox_from_preset("full-auto");
  const fs = sandbox.fs_access;

  const bypass_all = fs === "full-access"
    ? true
    : (config?.codex_bypass_sandbox ?? false);
  if (bypass_all) {
    if (!has_any_flag(out, ["--dangerously-bypass-approvals-and-sandbox"])) {
      out = with_codex_global_option(out, "--dangerously-bypass-approvals-and-sandbox");
    }
    return out;
  }

  const SANDBOX_MAP: Record<FsAccessLevel, string> = {
    "read-only": "read-only",
    "workspace-write": "workspace-write",
    "full-access": "workspace-write",
  };
  const sandbox_mode = SANDBOX_MAP[fs] || (config?.codex_sandbox_mode || "workspace-write");
  if (sandbox_mode && !has_any_flag(out, ["-s", "--sandbox", "--full-auto"])) {
    out = with_codex_global_option(out, "--sandbox", sandbox_mode);
  }

  if (!config?.workspace_dir) throw new Error("workspace_dir is required in CLI permission config");
  const workspace = config.workspace_dir;
  const policy_dirs = (sandbox.writable_roots || []).map((d) => resolve(d));
  const add_dirs_raw = config?.codex_add_dirs || "";
  const cfg_dirs = split_path_list(add_dirs_raw).map((d) => resolve(workspace, d));
  const all_dirs = [...policy_dirs, ...cfg_dirs];

  const existing_dirs = new Set<string>();
  for (let i = 0; i < out.length; i += 1) {
    const token = String(out[i] || "").trim().toLowerCase();
    if (token !== "--add-dir") continue;
    const dir = String(out[i + 1] || "").trim();
    if (!dir) continue;
    existing_dirs.add(resolve(dir).toLowerCase());
  }
  for (const dir of all_dirs) {
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
  config?: CliPermissionConfig,
): string[] {
  if (!is_claude_invocation(command, args)) return args;
  const out = [...args];
  const sandbox = runtime_policy?.sandbox ?? sandbox_from_preset("full-auto");

  const MODE_MAP: Record<FsAccessLevel, string> = {
    "read-only": "default",
    "workspace-write": "acceptEdits",
    "full-access": config?.claude_permission_mode || "dontAsk",
  };
  const mode = sandbox.plan_only ? "plan" : MODE_MAP[sandbox.fs_access];
  if (!mode) return out;
  if (!has_any_flag(out, ["--permission-mode"])) {
    out.push("--permission-mode", mode);
  }
  return out;
}

/** SandboxPolicy → Gemini CLI --approval-mode / --sandbox 플래그로 변환. */
export function with_gemini_permission_overrides(
  command: string,
  args: string[],
  runtime_policy?: ChatOptions["runtime_policy"],
  config?: CliPermissionConfig,
): string[] {
  if (!is_gemini_invocation(command, args)) return args;
  const out = [...args];
  const sandbox = runtime_policy?.sandbox ?? sandbox_from_preset("full-auto");

  // approval-mode: read-only=default, workspace-write=auto_edit, full-access=yolo
  const APPROVAL_MAP: Record<FsAccessLevel, string> = {
    "read-only": "default",
    "workspace-write": "auto_edit",
    "full-access": config?.gemini_approval_mode || "yolo",
  };
  const mode = sandbox.plan_only ? "default" : APPROVAL_MAP[sandbox.fs_access];
  if (mode && !has_any_flag(out, ["--approval-mode"])) {
    out.push("--approval-mode", mode);
  }

  // sandbox flag: read-only일 때만 활성화
  if (sandbox.fs_access === "read-only" && !has_any_flag(out, ["-s", "--sandbox"])) {
    out.push("--sandbox");
  }

  return out;
}

export function with_codex_mcp_runtime_overrides(
  command: string,
  args: string[],
  runtime_policy?: ChatOptions["runtime_policy"],
  config?: CliPermissionConfig,
): string[] {
  const enabled = config?.mcp_enabled ?? true;
  if (!enabled) return args;
  if (!is_codex_invocation(command, args)) return args;
  if (args.some((v) => /mcp_servers\./i.test(String(v || "")))) return args;
  if (!config?.workspace_dir) throw new Error("workspace_dir is required in CLI permission config");
  const cwd = resolve(config.workspace_dir);
  const runtime_allow = runtime_mcp_allowlist(runtime_policy?.mcp?.servers);
  const enable_all_project = typeof runtime_policy?.mcp?.enable_all_project === "boolean"
    ? runtime_policy.mcp.enable_all_project
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
