import { join } from "node:path";
import type { ToolRegistry } from "./registry.js";
import { DynamicShellTool } from "./dynamic.js";
import { SqliteDynamicToolStore, type DynamicToolStoreLike } from "./store.js";

export class DynamicToolRuntimeLoader {
  readonly workspace: string;
  readonly store_path: string;
  readonly store: DynamicToolStoreLike;

  constructor(workspace = process.cwd(), store_path_override?: string, store_override?: DynamicToolStoreLike) {
    this.workspace = workspace;
    this.store_path = store_path_override || join(workspace, "runtime", "custom-tools", "tools.db");
    this.store = store_override || new SqliteDynamicToolStore(workspace, this.store_path);
  }

  load_tools(): DynamicShellTool[] {
    const enabled = this.store.list_tools().filter((t) => t.enabled !== false && t.kind === "shell");
    return enabled.map((entry) => new DynamicShellTool(entry, this.workspace));
  }

  signature(): string {
    return this.store.signature();
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

  reload_now(): number {
    const tools = this.loader.load_tools();
    this.registry.set_dynamic_tools(tools);
    this.last_signature = this.loader.signature();
    return tools.length;
  }

  start(interval_ms = 2000): void {
    if (this.timer) return;
    this.reload_now();
    this.timer = setInterval(() => {
      const sig = this.loader.signature();
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
