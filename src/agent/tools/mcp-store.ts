import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

type McpRoot = Record<string, unknown> & {
  mcpServers?: Record<string, unknown>;
  mcp_servers?: Record<string, unknown>;
};

export type McpServerEntry = Record<string, unknown> & {
  command?: string;
  url?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  startup_timeout_sec?: number;
};

export interface McpServerStoreLike {
  get_path(): string;
  list_servers(): Promise<Record<string, McpServerEntry>>;
  upsert_server(name: string, entry: McpServerEntry): Promise<void>;
  remove_server(name: string): Promise<boolean>;
}

function ensure_json_object(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function normalize_server_entry(value: unknown): McpServerEntry {
  const raw = ensure_json_object(value) || {};
  const entry: McpServerEntry = {};
  if (raw.command !== undefined) entry.command = String(raw.command || "").trim();
  if (raw.url !== undefined) entry.url = String(raw.url || "").trim();
  if (Array.isArray(raw.args)) entry.args = raw.args.map((v) => String(v || "")).filter(Boolean);
  const env_raw = ensure_json_object(raw.env);
  if (env_raw && Object.keys(env_raw).length > 0) {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(env_raw)) env[String(k)] = String(v ?? "");
    entry.env = env;
  }
  if (raw.cwd !== undefined) entry.cwd = String(raw.cwd || "").trim();
  const timeout = Number(raw.startup_timeout_sec || 0);
  if (Number.isFinite(timeout) && timeout > 0) entry.startup_timeout_sec = Math.round(timeout);
  return entry;
}

export class FileMcpServerStore implements McpServerStoreLike {
  private readonly file_path: string;

  constructor(workspace = process.cwd(), file_path_override?: string) {
    this.file_path = resolve(String(file_path_override || join(workspace, ".mcp.json")));
  }

  get_path(): string {
    return this.file_path;
  }

  private async read_root(): Promise<McpRoot> {
    const raw = await readFile(this.file_path, "utf-8").catch(() => "");
    if (!raw.trim()) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      const obj = ensure_json_object(parsed);
      if (!obj) throw new Error("not_json_object");
      return obj as McpRoot;
    } catch {
      throw new Error(`invalid_mcp_json:${this.file_path}`);
    }
  }

  private async write_root(root: McpRoot): Promise<void> {
    await mkdir(dirname(this.file_path), { recursive: true });
    await writeFile(this.file_path, `${JSON.stringify(root, null, 2)}\n`, "utf-8");
  }

  private list_servers_from_root(root: McpRoot): Record<string, McpServerEntry> {
    const direct = ensure_json_object(root.mcpServers) || {};
    const snake = ensure_json_object(root.mcp_servers) || {};
    const merged: Record<string, unknown> = { ...snake, ...direct };
    const out: Record<string, McpServerEntry> = {};
    for (const [name, value] of Object.entries(merged)) {
      out[String(name)] = normalize_server_entry(value);
    }
    return out;
  }

  async list_servers(): Promise<Record<string, McpServerEntry>> {
    const root = await this.read_root();
    return this.list_servers_from_root(root);
  }

  async upsert_server(name_raw: string, entry_raw: McpServerEntry): Promise<void> {
    const name = String(name_raw || "").trim();
    if (!name) throw new Error("invalid_mcp_server_name");
    const root = await this.read_root();
    const direct = ensure_json_object(root.mcpServers) || {};
    direct[name] = normalize_server_entry(entry_raw);
    root.mcpServers = direct;
    const snake = ensure_json_object(root.mcp_servers);
    if (snake && Object.prototype.hasOwnProperty.call(snake, name)) {
      delete snake[name];
      root.mcp_servers = snake;
    }
    await this.write_root(root);
  }

  async remove_server(name_raw: string): Promise<boolean> {
    const name = String(name_raw || "").trim();
    if (!name) return false;
    const root = await this.read_root();
    const direct = ensure_json_object(root.mcpServers) || {};
    const snake = ensure_json_object(root.mcp_servers) || {};
    const existed = Object.prototype.hasOwnProperty.call(direct, name)
      || Object.prototype.hasOwnProperty.call(snake, name);
    delete direct[name];
    delete snake[name];
    root.mcpServers = direct;
    root.mcp_servers = snake;
    await this.write_root(root);
    return existed;
  }
}

