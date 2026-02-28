import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { JsonSchema, ToolExecutionContext } from "./types.js";
import { Tool } from "./base.js";
import { ToolInstallerService } from "./installer.js";
import { FileMcpServerStore, type McpServerEntry, type McpServerStoreLike } from "./mcp-store.js";
import { ensure_json_object } from "../../utils/common.js";

type RuntimeAdminArgs = {
  workspace: string;
  installer: ToolInstallerService;
  refresh_dynamic_tools?: () => number;
  refresh_skills?: () => void;
  list_registered_tool_names?: () => string[];
  mcp_store?: McpServerStoreLike;
};

function safe_skill_dir_name(name: string): string {
  const raw = String(name || "").trim().toLowerCase();
  const cleaned = raw
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "custom-skill";
}

async function walk_skill_files(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await readdir(current);
    } catch {
      continue;
    }
    for (const name of entries) {
      const path = join(current, name);
      const st = await stat(path).catch(() => null);
      if (!st) continue;
      if (st.isDirectory()) stack.push(path);
      else if (st.isFile() && name.toUpperCase() === "SKILL.MD") out.push(path);
    }
  }
  return out;
}

function parse_skill_name(raw: string): string {
  const content = String(raw || "");
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fm) return "";
  const name_line = fm[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^name\s*:/i.test(line));
  if (!name_line) return "";
  const value = name_line.replace(/^name\s*:/i, "").trim();
  return value.replace(/^["']|["']$/g, "").trim();
}

export class RuntimeAdminTool extends Tool {
  readonly name = "runtime_admin";
  readonly description = "Manage runtime capabilities: upsert/list skills, install/uninstall/list dynamic tools, and manage MCP servers.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "skill_upsert",
          "skill_list",
          "tool_install_shell",
          "tool_uninstall",
          "tool_list",
          "mcp_upsert_server",
          "mcp_remove_server",
          "mcp_list",
        ],
      },
      skill_name: { type: "string" },
      skill_summary: { type: "string" },
      skill_body: { type: "string" },
      skill_always: { type: "boolean" },
      tool_name: { type: "string" },
      tool_description: { type: "string" },
      tool_parameters: { type: "object" },
      tool_command_template: { type: "string" },
      tool_working_dir: { type: "string" },
      tool_overwrite: { type: "boolean" },
      tool_requires_approval: { type: "boolean" },
      mcp_server_name: { type: "string" },
      mcp_command: { type: "string" },
      mcp_args: { type: "array", items: { type: "string" } },
      mcp_env: { type: "object" },
      mcp_cwd: { type: "string" },
      mcp_url: { type: "string" },
      mcp_startup_timeout_sec: { type: "integer", minimum: 1 },
    },
    required: ["action"],
    additionalProperties: false,
  };

  private readonly workspace: string;
  private readonly installer: ToolInstallerService;
  private readonly refresh_dynamic_tools: (() => number) | null;
  private readonly refresh_skills: (() => void) | null;
  private readonly list_registered_tool_names: (() => string[]) | null;
  private readonly mcp_store: McpServerStoreLike;

  constructor(args: RuntimeAdminArgs) {
    super();
    this.workspace = resolve(String(args.workspace || process.cwd()));
    this.installer = args.installer;
    this.refresh_dynamic_tools = args.refresh_dynamic_tools || null;
    this.refresh_skills = args.refresh_skills || null;
    this.list_registered_tool_names = args.list_registered_tool_names || null;
    this.mcp_store = args.mcp_store || new FileMcpServerStore(this.workspace);
  }

  protected async run(params: Record<string, unknown>, _context?: ToolExecutionContext): Promise<string> {
    const action = String(params.action || "").trim().toLowerCase();
    if (!action) return "Error: action is required";

    if (action === "skill_upsert") return this.skill_upsert(params);
    if (action === "skill_list") return this.skill_list();
    if (action === "tool_install_shell") return this.tool_install_shell(params);
    if (action === "tool_uninstall") return this.tool_uninstall(params);
    if (action === "tool_list") return this.tool_list();
    if (action === "mcp_upsert_server") return this.mcp_upsert_server(params);
    if (action === "mcp_remove_server") return this.mcp_remove_server(params);
    if (action === "mcp_list") return this.mcp_list();

    return `Error: unsupported action '${action}'`;
  }

  private skill_dir(): string {
    return join(this.workspace, "skills");
  }

  private async skill_upsert(params: Record<string, unknown>): Promise<string> {
    const skill_name = String(params.skill_name || "").trim();
    const body = String(params.skill_body || "").trim();
    const summary = String(params.skill_summary || "").trim() || "User-defined runtime skill.";
    const always = params.skill_always === true;
    if (!skill_name) return "Error: skill_name is required";
    if (!body) return "Error: skill_body is required";
    const dir_name = safe_skill_dir_name(skill_name);
    const path = join(this.skill_dir(), dir_name, "SKILL.md");
    const frontmatter = [
      "---",
      `name: ${JSON.stringify(skill_name)}`,
      `summary: ${JSON.stringify(summary)}`,
      `always: ${always ? "true" : "false"}`,
      "---",
      "",
    ].join("\n");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${frontmatter}${body.trim()}\n`, "utf-8");
    if (this.refresh_skills) this.refresh_skills();
    return JSON.stringify({
      ok: true,
      action: "skill_upsert",
      skill: {
        name: skill_name,
        always,
        path,
      },
    });
  }

  private async skill_list(): Promise<string> {
    const root = this.skill_dir();
    const files = await walk_skill_files(root);
    const rows = (await Promise.all(files.map(async (p) => {
      const rel_name = p
        .replace(/\\/g, "/")
        .replace(root.replace(/\\/g, "/"), "")
        .replace(/^\/+/, "")
        .replace(/\/SKILL\.md$/i, "")
        .replace(/\//g, ".");
      const raw = await readFile(p, "utf-8").catch(() => "");
      const declared = parse_skill_name(raw);
      return {
        path: p,
        name: declared || rel_name,
      };
    })))
      .sort((a, b) => a.name.localeCompare(b.name));
    return JSON.stringify(rows);
  }

  private async tool_install_shell(params: Record<string, unknown>): Promise<string> {
    const tool_name = String(params.tool_name || "").trim();
    const tool_description = String(params.tool_description || "").trim();
    const tool_command_template = String(params.tool_command_template || "").trim();
    if (!tool_name) return "Error: tool_name is required";
    if (!/^[A-Za-z0-9_-]+$/.test(tool_name)) return "Error: invalid tool_name";
    if (!tool_description) return "Error: tool_description is required";
    if (!tool_command_template) return "Error: tool_command_template is required";
    const dynamic_names = new Set((await this.installer.list_tools()).map((row) => String(row.name || "").trim()).filter(Boolean));
    const registered = new Set((this.list_registered_tool_names ? this.list_registered_tool_names() : []).map((row) => String(row || "").trim()).filter(Boolean));
    if (registered.has(tool_name) && !dynamic_names.has(tool_name)) {
      return `Error: reserved tool_name '${tool_name}'`;
    }
    const schema_raw = ensure_json_object(params.tool_parameters) || {};
    const schema: JsonSchema = {
      type: "object",
      ...(schema_raw as JsonSchema),
    };
    const installed = await this.installer.install_shell_tool({
      name: tool_name,
      description: tool_description,
      parameters: schema,
      command_template: tool_command_template,
      working_dir: String(params.tool_working_dir || "").trim() || undefined,
      overwrite: params.tool_overwrite === true,
      requires_approval: params.tool_requires_approval === true,
    });
    if (installed.installed && this.refresh_dynamic_tools) {
      this.refresh_dynamic_tools();
    }
    return JSON.stringify({
      ok: installed.installed,
      reason: installed.reason || null,
      action: "tool_install_shell",
      tool_name,
    });
  }

  private async tool_uninstall(params: Record<string, unknown>): Promise<string> {
    const tool_name = String(params.tool_name || "").trim();
    if (!tool_name) return "Error: tool_name is required";
    const removed = await this.installer.uninstall_tool(tool_name);
    if (removed && this.refresh_dynamic_tools) {
      this.refresh_dynamic_tools();
    }
    return JSON.stringify({
      ok: removed,
      action: "tool_uninstall",
      tool_name,
    });
  }

  private async tool_list(): Promise<string> {
    const rows = await this.installer.list_tools();
    return JSON.stringify(rows);
  }

  private async mcp_list(): Promise<string> {
    const servers = await this.mcp_store.list_servers();
    return JSON.stringify(servers);
  }

  private async mcp_upsert_server(params: Record<string, unknown>): Promise<string> {
    const mcp_server_name = String(params.mcp_server_name || "").trim();
    if (!/^[A-Za-z0-9_-]+$/.test(mcp_server_name)) return "Error: invalid mcp_server_name";
    const mcp_command = String(params.mcp_command || "").trim();
    const mcp_url = String(params.mcp_url || "").trim();
    if (!mcp_command && !mcp_url) return "Error: one of mcp_command or mcp_url is required";
    if (mcp_command && mcp_url) return "Error: use either mcp_command or mcp_url (not both)";
    if (mcp_url) {
      if (Array.isArray(params.mcp_args) && params.mcp_args.length > 0) return "Error: mcp_args not allowed with mcp_url";
      if (String(params.mcp_cwd || "").trim()) return "Error: mcp_cwd not allowed with mcp_url";
      const mcp_env = ensure_json_object(params.mcp_env);
      if (mcp_env && Object.keys(mcp_env).length > 0) return "Error: mcp_env not allowed with mcp_url";
    }

    const entry: McpServerEntry = {};
    if (mcp_command) entry.command = mcp_command;
    if (mcp_url) entry.url = mcp_url;
    if (Array.isArray(params.mcp_args)) {
      entry.args = params.mcp_args.map((v) => String(v || "")).filter(Boolean);
    }
    const mcp_env = ensure_json_object(params.mcp_env);
    if (mcp_env && Object.keys(mcp_env).length > 0) {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(mcp_env)) env[String(k)] = String(v ?? "");
      entry.env = env;
    }
    const mcp_cwd = String(params.mcp_cwd || "").trim();
    if (mcp_cwd) entry.cwd = mcp_cwd;
    const timeout = Number(params.mcp_startup_timeout_sec || 0);
    if (Number.isFinite(timeout) && timeout > 0) entry.startup_timeout_sec = Math.round(timeout);

    await this.mcp_store.upsert_server(mcp_server_name, entry);
    return JSON.stringify({
      ok: true,
      action: "mcp_upsert_server",
      mcp_server_name,
      file: this.mcp_store.get_path(),
    });
  }

  private async mcp_remove_server(params: Record<string, unknown>): Promise<string> {
    const mcp_server_name = String(params.mcp_server_name || "").trim();
    if (!/^[A-Za-z0-9_-]+$/.test(mcp_server_name)) return "Error: invalid mcp_server_name";
    const existed = await this.mcp_store.remove_server(mcp_server_name);
    return JSON.stringify({
      ok: existed,
      action: "mcp_remove_server",
      mcp_server_name,
      file: this.mcp_store.get_path(),
    });
  }
}
