import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { JsonSchema } from "./types.js";
import type { DynamicToolManifestEntry } from "./dynamic.js";
import { file_exists } from "../../utils/common.js";

type DynamicToolManifest = {
  version: number;
  tools: DynamicToolManifestEntry[];
};

function default_manifest(): DynamicToolManifest {
  return { version: 1, tools: [] };
}

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
  readonly manifest_path: string;

  constructor(workspace = process.cwd(), manifest_path_override?: string) {
    this.workspace = workspace;
    this.manifest_path = manifest_path_override || join(workspace, "runtime", "custom-tools", "manifest.json");
  }

  private async load_manifest(): Promise<DynamicToolManifest> {
    if (!(await file_exists(this.manifest_path))) return default_manifest();
    try {
      const raw = await readFile(this.manifest_path, "utf-8");
      const parsed = JSON.parse(raw) as DynamicToolManifest;
      return {
        version: Number(parsed.version || 1),
        tools: Array.isArray(parsed.tools) ? parsed.tools : [],
      };
    } catch {
      return default_manifest();
    }
  }

  private async save_manifest(manifest: DynamicToolManifest): Promise<void> {
    await mkdir(dirname(this.manifest_path), { recursive: true });
    await writeFile(this.manifest_path, JSON.stringify(manifest, null, 2), "utf-8");
  }

  async install_shell_tool(input: InstallShellToolInput): Promise<{ installed: boolean; reason?: string }> {
    const manifest = await this.load_manifest();
    const exists = manifest.tools.find((t) => t.name === input.name);
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
    manifest.tools = manifest.tools.filter((t) => t.name !== input.name);
    manifest.tools.push(entry);
    await this.save_manifest(manifest);
    return { installed: true };
  }

  async uninstall_tool(name: string): Promise<boolean> {
    const manifest = await this.load_manifest();
    const before = manifest.tools.length;
    manifest.tools = manifest.tools.filter((t) => t.name !== name);
    if (manifest.tools.length === before) return false;
    await this.save_manifest(manifest);
    return true;
  }

  async list_tools(): Promise<DynamicToolManifestEntry[]> {
    const manifest = await this.load_manifest();
    return manifest.tools;
  }
}
