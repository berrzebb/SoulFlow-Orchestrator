import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type McpServerConfig = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  startup_timeout_sec?: number;
};

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

export function parse_bool_like(raw: string | undefined, fallback: boolean): boolean {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return fallback;
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return fallback;
}

export function should_enable_all_project_mcp_servers(cwd: string): boolean {
  if (String(process.env.ORCH_MCP_ENABLE_ALL_PROJECT || "").trim()) {
    return parse_bool_like(process.env.ORCH_MCP_ENABLE_ALL_PROJECT, true);
  }
  const settings_path = find_file_upward(cwd, join(".claude", "settings.json"));
  if (!settings_path) return false;
  const parsed = read_json_file(settings_path);
  if (!parsed) return false;
  return parsed.enableAllProjectMcpServers === true;
}

export function runtime_mcp_allowlist(mcp_servers: unknown): Set<string> | null {
  if (!Array.isArray(mcp_servers)) return null;
  const out = new Set<string>();
  for (const row of mcp_servers) {
    const name = normalize_mcp_server_name(String(row || ""));
    if (name) out.add(name);
  }
  return out;
}

export function load_mcp_servers_for_codex(cwd: string, allowlist?: Set<string> | null): Record<string, McpServerConfig> {
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
  const allow = allowlist && allowlist.size > 0
    ? allowlist
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

export function build_codex_mcp_overrides(servers: Record<string, McpServerConfig>): string[] {
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
