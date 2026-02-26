import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { TextDecoder } from "node:util";
import { BaseLlmProvider } from "./base.js";
import { LlmResponse, type ChatMessage, type ChatOptions, type ProviderId, type ToolCallRequest } from "./types.js";
import { dedupe_tool_calls, parse_tool_calls_from_text, parse_tool_calls_from_unknown } from "../agent/tool-call-parser.js";

const OUTPUT_BLOCK_START = "<<ORCH_FINAL>>";
const OUTPUT_BLOCK_END = "<<ORCH_FINAL_END>>";
const TOOL_BLOCK_START = "<<ORCH_TOOL_CALLS>>";
const TOOL_BLOCK_END = "<<ORCH_TOOL_CALLS_END>>";
const DEFAULT_CAPTURE_MAX_CHARS = 500_000;
const DEFAULT_STREAM_STATE_MAX_CHARS = 200_000;

type McpServerConfig = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  startup_timeout_sec?: number;
};

function compact_tool_catalog(tools: Record<string, unknown>[]): string {
  return tools
    .slice(0, 32)
    .map((row) => {
      const rec = (row && typeof row === "object") ? (row as Record<string, unknown>) : {};
      const fn = (rec.function && typeof rec.function === "object")
        ? (rec.function as Record<string, unknown>)
        : {};
      const name = String(fn.name || "").trim();
      if (!name) return "";
      const description = String(fn.description || "").trim();
      const parameters = (fn.parameters && typeof fn.parameters === "object")
        ? (fn.parameters as Record<string, unknown>)
        : {};
      const props_obj = (parameters.properties && typeof parameters.properties === "object")
        ? (parameters.properties as Record<string, unknown>)
        : {};
      const properties = Object.keys(props_obj).slice(0, 20);
      const required = Array.isArray(parameters.required)
        ? parameters.required.map((v) => String(v)).slice(0, 20)
        : [];
      return JSON.stringify({
        name,
        description: description || "",
        properties,
        required,
      });
    })
    .filter(Boolean)
    .join("\n");
}

function messages_to_prompt(messages: ChatMessage[], tools?: Record<string, unknown>[] | null): string {
  const base = messages
    .map((m) => {
      const role = String(m.role || "user").toUpperCase();
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
      return `[${role}] ${content}`;
    })
    .join("\n\n");
  const has_tools = Array.isArray(tools) && tools.length > 0;
  const tool_protocol = has_tools
    ? [
      "",
      "[TOOLS]",
      "If a tool is required, return only this exact block with valid JSON:",
      TOOL_BLOCK_START,
      '{"tool_calls":[{"id":"call_1","name":"tool_name","arguments":{"key":"value"}}]}',
      TOOL_BLOCK_END,
      "Otherwise, return the final answer block.",
      "Available tools (compact):",
      compact_tool_catalog(tools || []) || "(none)",
    ].join("\n")
    : "";
  const protocol = [
    "",
    "[SYSTEM]",
    has_tools
      ? "Return either a TOOL block or FINAL block. Never return both in one response."
      : "Return only the final user-facing answer wrapped in the exact block below.",
    "Start your response with the start marker immediately, stream the answer body, then close with end marker.",
    "Do not include execution logs, shell commands, env vars, or debug info.",
    OUTPUT_BLOCK_START,
    "<final answer>",
    OUTPUT_BLOCK_END,
  ].join("\n");
  return `${base}${tool_protocol}\n${protocol}`.trim();
}

function extract_protocol_output(raw: string): string {
  const text = String(raw || "");
  if (!text) return "";
  const escapedStart = OUTPUT_BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = OUTPUT_BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`, "g");
  let match: RegExpExecArray | null = null;
  let last = "";
  while (true) {
    match = re.exec(text);
    if (!match) break;
    last = String(match[1] || "").trim();
  }
  return last;
}

function extract_protocol_partial(raw: string): string {
  const text = String(raw || "");
  if (!text) return "";
  const start_idx = text.indexOf(OUTPUT_BLOCK_START);
  if (start_idx < 0) return "";
  const body_start = start_idx + OUTPUT_BLOCK_START.length;
  const end_idx = text.indexOf(OUTPUT_BLOCK_END, body_start);
  if (end_idx >= 0) return text.slice(body_start, end_idx);
  return text.slice(body_start);
}

function split_args(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function extract_last_block(raw: string, start_marker: string, end_marker: string): string {
  const text = String(raw || "");
  if (!text) return "";
  const escapedStart = start_marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = end_marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`, "g");
  let match: RegExpExecArray | null = null;
  let last = "";
  while (true) {
    match = re.exec(text);
    if (!match) break;
    last = String(match[1] || "").trim();
  }
  return last;
}

function parse_tool_calls_from_json_events(raw: string): ToolCallRequest[] {
  const out: ToolCallRequest[] = [];
  const lines = String(raw || "").split(/\r?\n/g);
  for (const line of lines) {
    const parsed = parse_json_line(line);
    if (!parsed) continue;
    const from_line = parse_tool_calls_from_unknown(parsed);
    for (const row of from_line) out.push(row);
  }
  return dedupe_tool_calls(out).slice(0, 32);
}

function parse_tool_calls_from_json_text(raw: string): ToolCallRequest[] {
  return parse_tool_calls_from_text(raw);
}

function parse_tool_calls_from_output(raw: string): ToolCallRequest[] {
  const block = extract_last_block(raw, TOOL_BLOCK_START, TOOL_BLOCK_END);
  const out: ToolCallRequest[] = [];
  if (block) {
    const from_block = parse_tool_calls_from_json_text(block);
    for (const row of from_block) out.push(row);
  }
  if (out.length > 0) return dedupe_tool_calls(out).slice(0, 32);

  const from_events = parse_tool_calls_from_json_events(raw);
  if (from_events.length > 0) return from_events;

  const final_from_json = extract_final_from_json_output(raw);
  if (final_from_json) {
    const final_block = extract_last_block(final_from_json, TOOL_BLOCK_START, TOOL_BLOCK_END);
    if (final_block) {
      const parsed = parse_tool_calls_from_json_text(final_block);
      if (parsed.length > 0) return parsed;
    }
    const parsed = parse_tool_calls_from_json_text(final_from_json);
    if (parsed.length > 0) return parsed;
  }

  const final_from_protocol = extract_protocol_output(raw);
  if (final_from_protocol) {
    const protocol_block = extract_last_block(final_from_protocol, TOOL_BLOCK_START, TOOL_BLOCK_END);
    if (protocol_block) {
      const parsed = parse_tool_calls_from_json_text(protocol_block);
      if (parsed.length > 0) return parsed;
    }
    const parsed = parse_tool_calls_from_json_text(final_from_protocol);
    if (parsed.length > 0) return parsed;
  }

  return [];
}

export const __cli_provider_test__ = {
  parse_tool_calls_from_output,
};

function split_command_with_embedded_args(raw: string): { command: string; args: string[] } {
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

function strip_approval_flags(args: string[]): string[] {
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

function parse_json_object(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(String(raw || "")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function read_json_file(path: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(path, "utf-8");
    return parse_json_object(raw);
  } catch {
    return null;
  }
}

function find_file_upward(start_dir: string, rel_path: string): string | null {
  let current = resolve(start_dir);
  while (true) {
    const candidate = join(current, rel_path);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function normalize_mcp_server_name(raw: string): string | null {
  const name = String(raw || "").trim();
  if (!name) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return null;
  return name;
}

function looks_like_path_token(v: string): boolean {
  const s = String(v || "").trim();
  if (!s) return false;
  if (s.startsWith("-")) return false;
  if (/^https?:\/\//i.test(s)) return false;
  if (isAbsolute(s)) return true;
  if (/^[.]{1,2}[\\/]/.test(s)) return true;
  if (/[\\/]/.test(s)) return true;
  if (/\.(?:js|mjs|cjs|ts|tsx|py|cmd|bat|exe|ps1|sh)$/i.test(s)) return true;
  return false;
}

function resolve_path_token_if_exists(raw: string, base_dirs: string[]): string {
  const v = String(raw || "").trim();
  if (!looks_like_path_token(v)) return v;
  if (isAbsolute(v)) return v;
  for (const base of base_dirs) {
    const candidate = resolve(base, v);
    if (existsSync(candidate)) return candidate;
  }
  return v;
}

function pick_mcp_server_object(root: Record<string, unknown>): Record<string, unknown> {
  const direct = root.mcpServers;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }
  const snake = root.mcp_servers;
  if (snake && typeof snake === "object" && !Array.isArray(snake)) {
    return snake as Record<string, unknown>;
  }
  return {};
}

function coerce_mcp_server_config(
  raw: unknown,
  base_dirs: string[],
  default_timeout_sec: number,
): McpServerConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  if (rec.enabled === false || rec.disabled === true) return null;

  const command_raw = typeof rec.command === "string" ? String(rec.command).trim() : "";
  const url_raw = typeof rec.url === "string" ? String(rec.url).trim() : "";
  if (!command_raw && !url_raw) return null;

  const out: McpServerConfig = {};
  if (command_raw) out.command = resolve_path_token_if_exists(command_raw, base_dirs);
  if (url_raw) out.url = url_raw;

  if (Array.isArray(rec.args)) {
    out.args = rec.args
      .map((v) => resolve_path_token_if_exists(String(v ?? ""), base_dirs))
      .filter((v) => Boolean(String(v || "").trim()));
  }

  if (rec.cwd && typeof rec.cwd === "string") {
    out.cwd = resolve_path_token_if_exists(String(rec.cwd), base_dirs);
  }

  if (rec.env && typeof rec.env === "object" && !Array.isArray(rec.env)) {
    const env_rec = rec.env as Record<string, unknown>;
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(env_rec)) {
      const key = String(k || "").trim();
      if (!key) continue;
      env[key] = String(v ?? "");
    }
    if (Object.keys(env).length > 0) out.env = env;
  }

  const timeout_num = Number(rec.startup_timeout_sec || rec.startupTimeoutSec || default_timeout_sec || 0);
  if (Number.isFinite(timeout_num) && timeout_num > 0) {
    out.startup_timeout_sec = Math.max(1, Math.round(timeout_num));
  }

  return out;
}

function extract_mcp_servers_from_object(
  root: Record<string, unknown>,
  base_dirs: string[],
  default_timeout_sec: number,
): Record<string, McpServerConfig> {
  const picked = pick_mcp_server_object(root);
  const out: Record<string, McpServerConfig> = {};
  for (const [name_raw, spec] of Object.entries(picked)) {
    const name = normalize_mcp_server_name(name_raw);
    if (!name) continue;
    const normalized = coerce_mcp_server_config(spec, base_dirs, default_timeout_sec);
    if (!normalized) continue;
    out[name] = normalized;
  }
  return out;
}

function merge_mcp_servers(
  base: Record<string, McpServerConfig>,
  incoming: Record<string, McpServerConfig>,
): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = { ...base };
  for (const [k, v] of Object.entries(incoming)) out[k] = v;
  return out;
}

function parse_server_name_allowlist(raw: string): Set<string> {
  const out = new Set<string>();
  for (const token of String(raw || "").split(",")) {
    const normalized = normalize_mcp_server_name(token);
    if (!normalized) continue;
    out.add(normalized);
  }
  return out;
}

function parse_bool_like(raw: string | undefined, fallback: boolean): boolean {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return fallback;
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return fallback;
}

function should_enable_all_project_mcp_servers(cwd: string): boolean {
  if (String(process.env.ORCH_MCP_ENABLE_ALL_PROJECT || "").trim()) {
    return parse_bool_like(process.env.ORCH_MCP_ENABLE_ALL_PROJECT, true);
  }
  const settings_path = find_file_upward(cwd, join(".claude", "settings.json"));
  if (!settings_path) return false;
  const parsed = read_json_file(settings_path);
  if (!parsed) return false;
  return parsed.enableAllProjectMcpServers === true;
}

function load_mcp_servers_for_codex(cwd: string, runtime_allowlist?: Set<string> | null): Record<string, McpServerConfig> {
  const default_timeout_sec = Math.max(0, Number(process.env.ORCH_MCP_STARTUP_TIMEOUT_SEC || 0));
  let merged: Record<string, McpServerConfig> = {};
  const base_dirs = [cwd];

  const settings_path = find_file_upward(cwd, join(".claude", "settings.json"));
  if (settings_path) {
    const parsed = read_json_file(settings_path);
    if (parsed) {
      const project_root = dirname(dirname(settings_path));
      merged = merge_mcp_servers(
        merged,
        extract_mcp_servers_from_object(parsed, [project_root, dirname(settings_path), ...base_dirs], default_timeout_sec),
      );
    }
  }

  const mcp_json_path = find_file_upward(cwd, ".mcp.json");
  if (mcp_json_path) {
    const parsed = read_json_file(mcp_json_path);
    if (parsed) {
      merged = merge_mcp_servers(
        merged,
        extract_mcp_servers_from_object(parsed, [dirname(mcp_json_path), ...base_dirs], default_timeout_sec),
      );
    }
  }

  const env_file = String(process.env.ORCH_MCP_SERVERS_FILE || "").trim();
  if (env_file) {
    const abs = resolve(cwd, env_file);
    const parsed = read_json_file(abs);
    if (parsed) {
      merged = merge_mcp_servers(
        merged,
        extract_mcp_servers_from_object(parsed, [dirname(abs), ...base_dirs], default_timeout_sec),
      );
    }
  }

  const env_json = String(process.env.ORCH_MCP_SERVERS_JSON || "").trim();
  if (env_json) {
    const parsed = parse_json_object(env_json);
    if (parsed) {
      merged = merge_mcp_servers(
        merged,
        extract_mcp_servers_from_object(parsed, base_dirs, default_timeout_sec),
      );
    }
  }

  const env_allow = parse_server_name_allowlist(String(process.env.ORCH_MCP_SERVER_NAMES || ""));
  const allow = runtime_allowlist && runtime_allowlist.size > 0
    ? runtime_allowlist
    : (env_allow.size > 0 ? env_allow : null);
  if (allow) {
    const filtered: Record<string, McpServerConfig> = {};
    for (const [name, spec] of Object.entries(merged)) {
      if (!allow.has(name)) continue;
      filtered[name] = spec;
    }
    return filtered;
  }

  return merged;
}

function toml_string(v: string): string {
  return JSON.stringify(String(v ?? ""));
}

function toml_array_of_strings(values: string[]): string {
  return `[${values.map((v) => toml_string(v)).join(", ")}]`;
}

function toml_key(k: string): string {
  const key = String(k || "").trim();
  if (/^[A-Za-z0-9_-]+$/.test(key)) return key;
  return JSON.stringify(key);
}

function toml_inline_table(table: Record<string, string>): string {
  const entries = Object.entries(table).map(([k, v]) => `${toml_key(k)} = ${toml_string(v)}`);
  return `{ ${entries.join(", ")} }`;
}

function build_codex_mcp_overrides(servers: Record<string, McpServerConfig>): string[] {
  const out: string[] = [];
  for (const [name, spec] of Object.entries(servers)) {
    if (spec.command) out.push(`mcp_servers.${name}.command=${toml_string(spec.command)}`);
    if (spec.url) out.push(`mcp_servers.${name}.url=${toml_string(spec.url)}`);
    if (Array.isArray(spec.args) && spec.args.length > 0) {
      out.push(`mcp_servers.${name}.args=${toml_array_of_strings(spec.args)}`);
    }
    if (spec.cwd) out.push(`mcp_servers.${name}.cwd=${toml_string(spec.cwd)}`);
    if (spec.env && Object.keys(spec.env).length > 0) {
      out.push(`mcp_servers.${name}.env=${toml_inline_table(spec.env)}`);
    }
    if (Number.isFinite(spec.startup_timeout_sec) && Number(spec.startup_timeout_sec) > 0) {
      out.push(`mcp_servers.${name}.startup_timeout_sec=${Math.max(1, Math.round(Number(spec.startup_timeout_sec)))}`);
    }
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

function runtime_mcp_allowlist(runtime_policy: ChatOptions["runtime_policy"]): Set<string> | null {
  if (!runtime_policy || !Array.isArray(runtime_policy.mcp_servers)) return null;
  const out = new Set<string>();
  for (const row of runtime_policy.mcp_servers) {
    const name = normalize_mcp_server_name(String(row || ""));
    if (name) out.add(name);
  }
  return out;
}

function strip_protocol_markers(raw: string): string {
  return String(raw || "")
    .replace(new RegExp(OUTPUT_BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "")
    .replace(new RegExp(OUTPUT_BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "")
    .replace(new RegExp(TOOL_BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "")
    .replace(new RegExp(TOOL_BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "")
    .trim();
}

function strip_protocol_scaffold(raw: string): string {
  const text = strip_protocol_markers(raw).replace(/\r/g, "");
  if (!text) return "";
  const lines = text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => {
      const t = l.trim();
      if (!t) return false;
      if (/^\[SYSTEM\]$/i.test(t)) return false;
      if (/^Return only the final user-facing answer wrapped in the exact block below\.?$/i.test(t)) return false;
      if (/^Start your response with the start marker immediately/i.test(t)) return false;
      if (/^Do not include execution logs, shell commands, env vars, or debug info\.?$/i.test(t)) return false;
      if (/^Return either a TOOL block or FINAL block/i.test(t)) return false;
      if (/^If a tool is required, return only this exact block/i.test(t)) return false;
      if (/^Otherwise, return the final answer block\.?$/i.test(t)) return false;
      if (/^Available tools \(compact\):$/i.test(t)) return false;
      if (/^<final answer>$/i.test(t)) return false;
      return true;
    });
  return lines.join("\n").trim();
}

function append_limited(base: string, incoming: string, max_chars: number): string {
  const max = Math.max(1_000, Number(max_chars || DEFAULT_CAPTURE_MAX_CHARS));
  const merged = `${base}${incoming}`;
  if (merged.length <= max) return merged;
  return merged.slice(merged.length - max);
}

function count_replacement_chars(text: string): number {
  return (text.match(/�/g) || []).length;
}

function decode_chunk(chunk: unknown): string {
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? ""));
  const utf8 = buf.toString("utf8");
  const utf8_bad = count_replacement_chars(utf8);
  if (utf8_bad === 0) return utf8;
  try {
    const euckr = new TextDecoder("euc-kr").decode(buf);
    const euckr_bad = count_replacement_chars(euckr);
    return euckr_bad <= utf8_bad ? euckr : utf8;
  } catch {
    return utf8;
  }
}

function as_string(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function collect_text_deep(value: unknown, depth = 0): string {
  if (depth > 4) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 16)
      .map((v) => collect_text_deep(v, depth + 1))
      .filter(Boolean)
      .join("");
  }
  if (!value || typeof value !== "object") return "";
  const rec = value as Record<string, unknown>;
  const direct = as_string(rec.text) || as_string(rec.value);
  if (direct) return direct;
  if (rec.delta && typeof rec.delta === "object") {
    const d = rec.delta as Record<string, unknown>;
    const delta_text = as_string(d.text) || as_string(d.value);
    if (delta_text) return delta_text;
  }
  if (rec.message && typeof rec.message === "object") {
    const message = rec.message as Record<string, unknown>;
    const from_message = collect_text_deep(message.content, depth + 1) || as_string(message.text);
    if (from_message) return from_message;
  }
  if (rec.content) {
    const from_content = collect_text_deep(rec.content, depth + 1);
    if (from_content) return from_content;
  }
  return "";
}

function parse_json_line(line: string): Record<string, unknown> | null {
  const raw = String(line || "").trim();
  if (!raw.startsWith("{") || !raw.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extract_json_event_text(
  event: Record<string, unknown>,
  state: { last_full_text: string },
): { delta?: string; final?: string } {
  const type = as_string(event.type).toLowerCase();
  if (!type) return {};

  if (type === "item.completed" && event.item && typeof event.item === "object") {
    const item = event.item as Record<string, unknown>;
    const item_type = as_string(item.type).toLowerCase();
    const text = collect_text_deep(item);
    if (!text) return {};
    if (item_type === "agent_message" || item_type === "assistant_message" || item_type === "message") {
      const full = strip_protocol_markers(text);
      if (!full) return {};
      let delta = full;
      if (state.last_full_text && full.startsWith(state.last_full_text)) {
        delta = full.slice(state.last_full_text.length);
      }
      state.last_full_text = full;
      return { delta, final: full };
    }
    if (item_type === "reasoning") return {};
  }

  if (type.includes("delta")) {
    const delta = collect_text_deep(event);
    if (delta && delta.trim()) return { delta };
    return {};
  }

  if (type.includes("message.completed") || type === "assistant") {
    const full = strip_protocol_markers(collect_text_deep(event));
    if (!full) return {};
    let delta = full;
    if (state.last_full_text && full.startsWith(state.last_full_text)) {
      delta = full.slice(state.last_full_text.length);
    }
    state.last_full_text = full;
    return { delta, final: full };
  }

  return {};
}

function extract_final_from_json_output(raw: string): string {
  const state = { last_full_text: "" };
  let out = "";
  const lines = String(raw || "").split(/\r?\n/g);
  for (const line of lines) {
    const parsed = parse_json_line(line);
    if (!parsed) continue;
    const extracted = extract_json_event_text(parsed, state);
    if (extracted.final && extracted.final.trim()) out = extracted.final.trim();
  }
  return out;
}

async function run_cli(
  command: string,
  args: string[],
  prompt: string,
  timeout_ms: number,
  abort_signal?: AbortSignal,
  on_chunk?: (chunk: string) => void | Promise<void>,
  capture_max_chars = DEFAULT_CAPTURE_MAX_CHARS,
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> {
  const resolved = resolve_command_for_windows(command);
  const use_cmd_wrapper = process.platform === "win32" && /\.(cmd|bat)$/i.test(resolved);
  return new Promise((resolve) => {
    const child = use_cmd_wrapper
      ? spawn("cmd.exe", ["/d", "/s", "/c", strip_surrounding_quotes(resolved), ...args], {
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
          windowsHide: true,
        })
      : spawn(resolved, args, {
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
          windowsHide: true,
        });
    let stdout = "";
    let stderr = "";
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill();
      resolve({ ok: false, stdout, stderr: `${stderr}\ncli_timeout_${timeout_ms}ms`.trim(), code: null });
    }, timeout_ms);
    const on_abort = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve({ ok: false, stdout, stderr: `${stderr}\naborted_by_user`.trim(), code: null });
    };
    abort_signal?.addEventListener("abort", on_abort, { once: true });

    child.stdout.on("data", (chunk) => {
      const text = decode_chunk(chunk);
      stdout = append_limited(stdout, text, capture_max_chars);
      if (on_chunk) void Promise.resolve(on_chunk(text)).catch(() => {});
    });
    child.stderr.on("data", (chunk) => {
      const text = decode_chunk(chunk);
      stderr = append_limited(stderr, text, capture_max_chars);
      if (on_chunk) void Promise.resolve(on_chunk(text)).catch(() => {});
    });
    child.on("error", (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      abort_signal?.removeEventListener("abort", on_abort);
      resolve({ ok: false, stdout, stderr: `${stderr}\n${error.message}`.trim(), code: null });
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      abort_signal?.removeEventListener("abort", on_abort);
      resolve({ ok: code === 0, stdout, stderr, code });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function strip_surrounding_quotes(v: string): string {
  const s = String(v || "").trim();
  if ((s.startsWith("\"") && s.endsWith("\"")) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).trim();
  }
  return s;
}

function resolve_command_for_windows(command: string): string {
  if (process.platform !== "win32") return command;
  const cmd = strip_surrounding_quotes(String(command || "").trim());
  if (!cmd) return cmd;
  if (/[/\\]/.test(cmd) || /\.[A-Za-z0-9]+$/.test(cmd)) return cmd;

  if (cmd.toLowerCase() === "codex") {
    const appData = String(process.env.APPDATA || "").trim();
    const candidates = [
      appData ? join(appData, "npm", "codex.cmd") : "",
      appData ? join(appData, "npm", "codex.exe") : "",
      appData ? join(appData, "npm", "codex") : "",
      "codex.cmd",
      "codex.exe",
    ].filter(Boolean);
    for (const c of candidates) {
      if (/[\\/]/.test(c) && existsSync(c)) return c;
      if (!/[\\/]/.test(c)) return c;
    }
    return "codex.cmd";
  }
  if (cmd.toLowerCase() === "claude") {
    return "claude.exe";
  }
  return cmd;
}

function command_basename(command: string): string {
  const raw = strip_surrounding_quotes(String(command || "").trim()).toLowerCase();
  if (!raw) return "";
  const idx = Math.max(raw.lastIndexOf("/"), raw.lastIndexOf("\\"));
  return idx >= 0 ? raw.slice(idx + 1) : raw;
}

function is_codex_command(command: string): boolean {
  const base = command_basename(command);
  return base === "codex" || base === "codex.exe" || base === "codex.cmd" || base === "codex.ps1";
}

function is_claude_command(command: string): boolean {
  const base = command_basename(command);
  return base === "claude" || base === "claude.exe" || base === "claude.cmd";
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

function first_non_flag_index(args: string[]): number {
  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || "").trim();
    if (!token) continue;
    if (!token.startsWith("-")) return i;
  }
  return -1;
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

function with_codex_permission_overrides(
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

function with_claude_permission_overrides(
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

function with_codex_mcp_runtime_overrides(
  command: string,
  args: string[],
  runtime_policy?: ChatOptions["runtime_policy"],
): string[] {
  const enabled = String(process.env.ORCH_MCP_ENABLED || "1").trim() !== "0";
  if (!enabled) return args;
  if (!is_codex_invocation(command, args)) return args;
  if (args.some((v) => /mcp_servers\./i.test(String(v || "")))) return args;
  const cwd = resolve(String(process.env.WORKSPACE_DIR || process.cwd()));
  const runtime_allow = runtime_mcp_allowlist(runtime_policy);
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

export class CliHeadlessProvider extends BaseLlmProvider {
  private readonly command_env: string;
  private readonly args_env: string;
  private readonly timeout_env: string;
  private readonly default_command: string;
  private readonly default_args: string;
  private readonly default_timeout_ms: number;

  constructor(args: {
    id: ProviderId;
    api_base?: string;
    default_model: string;
    command_env: string;
    args_env: string;
    timeout_env: string;
    default_command: string;
    default_args?: string;
    default_timeout_ms?: number;
  }) {
    super({
      id: args.id,
      api_base: args.api_base ?? "cli://local",
      default_model: args.default_model,
    });
    this.command_env = args.command_env;
    this.args_env = args.args_env;
    this.timeout_env = args.timeout_env;
    this.default_command = args.default_command;
    this.default_args = args.default_args || "";
    this.default_timeout_ms = args.default_timeout_ms || 180000;
  }

  async chat(options: ChatOptions): Promise<LlmResponse> {
    const tools = Array.isArray(options.tools) ? options.tools : [];
    const prompt = messages_to_prompt(this.sanitize_messages(options.messages), tools);
    const command_env_value = String(process.env[this.command_env] || this.default_command).trim();
    const normalized = split_command_with_embedded_args(command_env_value);
    const command = normalized.command;
    if (!command) {
      return new LlmResponse({
        content: `Error calling ${this.id}: env_missing:${this.command_env}`,
        finish_reason: "error",
      });
    }

    const raw_args = String(process.env[this.args_env] || this.default_args).trim();
    let args = strip_approval_flags([...normalized.args, ...split_args(raw_args)]);
    // Safe default for codex headless: force non-interactive exec mode.
    if (is_codex_command(command) && args.length === 0) {
      args = ["exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "-"];
    }
    // Safe default for claude headless: force print mode from stdin.
    if (is_claude_command(command) && args.length === 0) {
      args = ["-p", "--output-format", "text", "--permission-mode", "dontAsk", "-"];
    }
    args = with_codex_permission_overrides(command, args, options.runtime_policy);
    args = with_claude_permission_overrides(command, args, options.runtime_policy);
    args = with_codex_mcp_runtime_overrides(command, args, options.runtime_policy);
    const timeout_ms = Math.max(1000, Number(process.env[this.timeout_env] || this.default_timeout_ms));
    const capture_max_chars = Math.max(
      10_000,
      Number(process.env.CLI_PROVIDER_MAX_CAPTURE_CHARS || DEFAULT_CAPTURE_MAX_CHARS),
    );
    const stream_state_max_chars = Math.max(
      8_000,
      Number(process.env.CLI_PROVIDER_MAX_STREAM_STATE_CHARS || DEFAULT_STREAM_STATE_MAX_CHARS),
    );
    const json_mode = args.includes("--json") || raw_args.includes("stream-json");
    let streamed_partial = "";
    let raw_stream = "";
    let json_line_buffer = "";
    let final_from_json = "";
    let saw_json_event = false;
    const json_state = { last_full_text: "" };
    let last_emitted_chunk_key = "";
    let last_emitted_chunk_at = 0;
    const emit_stream = async (raw: string): Promise<void> => {
      const clean = strip_protocol_scaffold(raw);
      if (!clean) return;
      const key = clean.replace(/\s+/g, " ").trim().toLowerCase();
      if (!key) return;
      const now = Date.now();
      if (key === last_emitted_chunk_key && now - last_emitted_chunk_at < 30_000) return;
      last_emitted_chunk_key = key;
      last_emitted_chunk_at = now;
      await options.on_stream?.(clean);
    };
    const on_chunk = options.on_stream
      ? async (chunk: string) => {
          const incoming = String(chunk || "");
          if (!incoming) return;

          if (json_mode || saw_json_event) {
            json_line_buffer = append_limited(json_line_buffer, incoming, stream_state_max_chars);
            while (true) {
              const idx = json_line_buffer.indexOf("\n");
              if (idx < 0) break;
              const line = json_line_buffer.slice(0, idx).trim();
              json_line_buffer = json_line_buffer.slice(idx + 1);
              if (!line) continue;
              const parsed = parse_json_line(line);
              if (!parsed) continue;
              saw_json_event = true;
              const extracted = extract_json_event_text(parsed, json_state);
              if (extracted.final && extracted.final.trim()) {
                final_from_json = strip_protocol_scaffold(extracted.final);
              }
              if (extracted.delta && extracted.delta.trim()) {
                await emit_stream(extracted.delta);
              }
            }
            return;
          }

          raw_stream = append_limited(raw_stream, incoming, stream_state_max_chars);
          const partial = extract_protocol_partial(raw_stream);
          if (!partial) return;
          if (partial.length <= streamed_partial.length) return;
          const delta = partial.slice(streamed_partial.length);
          streamed_partial = partial;
          await emit_stream(delta);
        }
      : undefined;

    const result = await run_cli(
      command,
      args,
      prompt,
      timeout_ms,
      options.abort_signal,
      on_chunk,
      capture_max_chars,
    );
    if (!result.ok) {
      const stderr = result.stderr.trim();
      const stdout = result.stdout.trim();
      const combined = [stderr, stdout].filter(Boolean).join(" | ");
      const reason = combined || `exit_code_${String(result.code)}`;
      return new LlmResponse({
        content: `Error calling ${this.id}: ${reason}`,
        finish_reason: "error",
      });
    }
    const merged_output = `${result.stdout}\n${result.stderr}`;
    const tool_calls = parse_tool_calls_from_output(merged_output);
    if (tool_calls.length > 0) {
      return new LlmResponse({
        content: null,
        tool_calls,
        finish_reason: "tool_calls",
      });
    }
    const jsonText = extract_final_from_json_output(merged_output) || final_from_json;
    const protocolText = extract_protocol_output(result.stdout) || extract_protocol_output(result.stderr);
    const text = strip_protocol_scaffold(String(jsonText || protocolText || result.stdout || result.stderr || ""));
    if (!text) {
      return new LlmResponse({
        content: `Error calling ${this.id}: no_protocol_output`,
        finish_reason: "error",
      });
    }
    return new LlmResponse({
      content: text || null,
      finish_reason: "stop",
    });
  }
}
