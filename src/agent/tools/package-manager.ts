/** Package Manager 도구 — npm/pip/cargo 패키지 관리. */

import { Tool } from "./base.js";
import { run_shell_command } from "./shell-runtime.js";
import { error_message } from "../../utils/common.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

type PkgManager = "npm" | "pip" | "cargo";

export class PackageManagerTool extends Tool {
  readonly name = "package_manager";
  readonly category = "shell" as const;
  readonly policy_flags = { write: true } as const;
  readonly description = "Manage packages: list, install, uninstall, audit, outdated. Auto-detects npm/pip/cargo.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["list", "install", "uninstall", "audit", "outdated", "info"],
        description: "Package operation",
      },
      manager: { type: "string", enum: ["npm", "pip", "cargo"], description: "Package manager (auto-detected if omitted)" },
      package_name: { type: "string", description: "Package name (for install/uninstall/info)" },
      flags: { type: "string", description: "Additional flags (e.g., --save-dev, --global)" },
    },
    required: ["operation"],
    additionalProperties: false,
  };

  private readonly workspace: string;

  constructor(options: { workspace: string }) {
    super();
    this.workspace = options.workspace;
  }

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const op = String(params.operation || "list");
    const mgr = (params.manager ? String(params.manager) : this.detect_manager()) as PkgManager;
    const pkg = String(params.package_name || "").trim();
    const flags = String(params.flags || "").trim();

    if (context?.signal?.aborted) return "Error: cancelled";

    const cmd = this.build_command(mgr, op, pkg, flags);
    if (!cmd) return `Error: unsupported "${mgr} ${op}" or missing package name`;

    try {
      const { stdout, stderr } = await run_shell_command(cmd, {
        cwd: this.workspace,
        timeout_ms: 120_000,
        max_buffer_bytes: 1024 * 1024 * 4,
        signal: context?.signal,
      });
      const output = [stdout || "", stderr ? `STDERR:\n${stderr}` : ""].filter(Boolean).join("\n").trim();
      const text = output || "(no output)";
      return text.length > 20_000 ? `${text.slice(0, 20_000)}\n... (truncated)` : text;
    } catch (err) {
      return `Error: ${error_message(err)}`;
    }
  }

  private detect_manager(): PkgManager {
    if (existsSync(join(this.workspace, "package.json"))) return "npm";
    if (existsSync(join(this.workspace, "requirements.txt")) || existsSync(join(this.workspace, "pyproject.toml"))) return "pip";
    if (existsSync(join(this.workspace, "Cargo.toml"))) return "cargo";
    return "npm";
  }

  private build_command(mgr: PkgManager, op: string, pkg: string, flags: string): string | null {
    const f = flags ? ` ${flags}` : "";
    switch (mgr) {
      case "npm": {
        switch (op) {
          case "list":      return `npm list --depth=0${f}`;
          case "install":   return pkg ? `npm install ${pkg}${f}` : `npm install${f}`;
          case "uninstall": return pkg ? `npm uninstall ${pkg}${f}` : null;
          case "audit":     return `npm audit${f}`;
          case "outdated":  return `npm outdated${f}`;
          case "info":      return pkg ? `npm info ${pkg}${f}` : null;
          default: return null;
        }
      }
      case "pip": {
        switch (op) {
          case "list":      return `pip list${f}`;
          case "install":   return pkg ? `pip install ${pkg}${f}` : null;
          case "uninstall": return pkg ? `pip uninstall -y ${pkg}${f}` : null;
          case "audit":     return `pip check${f}`;
          case "outdated":  return `pip list --outdated${f}`;
          case "info":      return pkg ? `pip show ${pkg}${f}` : null;
          default: return null;
        }
      }
      case "cargo": {
        switch (op) {
          case "list":      return `cargo install --list${f}`;
          case "install":   return pkg ? `cargo add ${pkg}${f}` : null;
          case "uninstall": return pkg ? `cargo remove ${pkg}${f}` : null;
          case "audit":     return `cargo audit${f}`;
          case "outdated":  return `cargo outdated${f}`;
          case "info":      return pkg ? `cargo search ${pkg} --limit 5${f}` : null;
          default: return null;
        }
      }
      default: return null;
    }
  }
}
