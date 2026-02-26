import { join } from "node:path";
import type { JsonSchema } from "./types.js";
import type { DynamicToolManifestEntry } from "./dynamic.js";
import { SqliteDynamicToolStore, type DynamicToolStoreLike } from "./store.js";

export type InstallShellToolInput = {
  name: string;
  description: string;
  parameters: JsonSchema;
  command_template: string;
  working_dir?: string;
  overwrite?: boolean;
  requires_approval?: boolean;
};

const WRITE_RISK_PATTERNS = [
  /\becho\b.*>/i,
  />>/i,
  /\btee\b/i,
  /\bset-content\b/i,
  /\badd-content\b/i,
  /\bout-file\b/i,
  /\bcopy-item\b/i,
  /\bmove-item\b/i,
  /\bnew-item\b/i,
  /\bremove-item\b/i,
  /\bmkdir\b/i,
  /\bmd\b/i,
  /\btouch\b/i,
  /\bcp\b/i,
  /\bmv\b/i,
  /\brm\b/i,
  /\bsed\b.*-i/i,
  /\bperl\b.*-i/i,
  /\bgit\s+(commit|push|merge|rebase|tag)\b/i,
  /\bnpm\s+(install|update|uninstall)\b/i,
  /\bcargo\s+(add|remove)\b/i,
];

function has_write_risk(command_template: string): boolean {
  return WRITE_RISK_PATTERNS.some((p) => p.test(command_template));
}

export class ToolInstallerService {
  readonly workspace: string;
  readonly store_path: string;
  readonly store: DynamicToolStoreLike;

  constructor(workspace = process.cwd(), store_path_override?: string, store_override?: DynamicToolStoreLike) {
    this.workspace = workspace;
    this.store_path = store_path_override || join(workspace, "runtime", "custom-tools", "tools.db");
    this.store = store_override || new SqliteDynamicToolStore(workspace, this.store_path);
  }

  async install_shell_tool(input: InstallShellToolInput): Promise<{ installed: boolean; reason?: string }> {
    const existing = this.store.list_tools();
    const exists = existing.find((t) => t.name === input.name);
    if (exists && !input.overwrite) return { installed: false, reason: "tool_already_exists" };
    const entry: DynamicToolManifestEntry = {
      name: input.name,
      description: input.description,
      enabled: true,
      kind: "shell",
      parameters: input.parameters,
      command_template: input.command_template,
      working_dir: input.working_dir,
      requires_approval: input.requires_approval === true || has_write_risk(input.command_template),
    };
    const installed = this.store.upsert_tool(entry);
    return { installed };
  }

  async uninstall_tool(name: string): Promise<boolean> {
    return this.store.remove_tool(name);
  }

  async list_tools(): Promise<DynamicToolManifestEntry[]> {
    return this.store.list_tools();
  }
}
