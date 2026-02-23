import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolRegistry } from "./registry.js";
import { DynamicShellTool, type DynamicToolManifestEntry } from "./dynamic.js";

type DynamicToolManifest = {
  version: number;
  tools: DynamicToolManifestEntry[];
};

function read_manifest(path: string): DynamicToolManifest {
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as DynamicToolManifest;
    return {
      version: Number(parsed.version || 1),
      tools: Array.isArray(parsed.tools) ? parsed.tools : [],
    };
  } catch {
    return { version: 1, tools: [] };
  }
}

export class DynamicToolRuntimeLoader {
  readonly workspace: string;
  readonly manifest_path: string;

  constructor(workspace = process.cwd(), manifest_path_override?: string) {
    this.workspace = workspace;
    this.manifest_path = manifest_path_override || join(workspace, "runtime", "custom-tools", "manifest.json");
  }

  load_tools(): DynamicShellTool[] {
    const manifest = read_manifest(this.manifest_path);
    const enabled = manifest.tools.filter((t) => t.enabled !== false && t.kind === "shell");
    return enabled.map((entry) => new DynamicShellTool(entry, this.workspace));
  }
}

export class ToolRuntimeReloader {
  private readonly loader: DynamicToolRuntimeLoader;
  private readonly registry: ToolRegistry;
  private timer: NodeJS.Timeout | null = null;
  private last_signature = "";

  constructor(loader: DynamicToolRuntimeLoader, registry: ToolRegistry) {
    this.loader = loader;
    this.registry = registry;
  }

  private signature(): string {
    try {
      const raw = readFileSync(this.loader.manifest_path, "utf-8");
      return `${raw.length}:${raw.slice(0, 128)}`;
    } catch {
      return "missing";
    }
  }

  reload_now(): number {
    const tools = this.loader.load_tools();
    this.registry.set_dynamic_tools(tools);
    this.last_signature = this.signature();
    return tools.length;
  }

  start(interval_ms = 2000): void {
    if (this.timer) return;
    this.reload_now();
    this.timer = setInterval(() => {
      const sig = this.signature();
      if (sig === this.last_signature) return;
      this.reload_now();
    }, Math.max(500, interval_ms));
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
