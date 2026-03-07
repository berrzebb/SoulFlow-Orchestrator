/** Package Manager 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { PackageManagerNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { run_shell_command } from "../tools/shell-runtime.js";
import { error_message } from "../../utils/common.js";

export const package_manager_handler: NodeHandler = {
  node_type: "package_manager",
  icon: "\u{1F4E6}",
  color: "#c62828",
  shape: "rect",
  output_schema: [
    { name: "output",  type: "string",  description: "Command output" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "operation",    type: "string", description: "list / install / uninstall / audit / outdated / info" },
    { name: "manager",      type: "string", description: "npm / pip / cargo" },
    { name: "package_name", type: "string", description: "Package name" },
  ],
  create_default: () => ({ operation: "list", manager: "npm", package_name: "", flags: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as PackageManagerNodeDefinition;
    const tpl = { memory: ctx.memory };
    const op = resolve_templates(n.operation || "list", tpl);
    const mgr = resolve_templates(n.manager || "npm", tpl);
    const pkg = resolve_templates(n.package_name || "", tpl).trim();
    const flags = resolve_templates(n.flags || "", tpl).trim();

    const cmd = build_pkg_cmd(mgr, op, pkg, flags);
    if (!cmd) return { output: { output: "", success: false, error: `unsupported: ${mgr} ${op}` } };

    try {
      const { stdout, stderr } = await run_shell_command(cmd, {
        cwd: ctx.workspace,
        timeout_ms: 120_000,
        max_buffer_bytes: 1024 * 1024 * 4,
        signal: ctx.abort_signal,
      });
      const out = [stdout || "", stderr || ""].join("\n").trim();
      return { output: { output: out || "(no output)", success: true } };
    } catch (err) {
      return { output: { output: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as PackageManagerNodeDefinition;
    const warnings: string[] = [];
    if (!n.operation) warnings.push("operation is required");
    if (["install", "uninstall", "info"].includes(n.operation || "") && !n.package_name) warnings.push("package_name required");
    return { preview: { manager: n.manager, operation: n.operation, package_name: n.package_name }, warnings };
  },
};

function build_pkg_cmd(mgr: string, op: string, pkg: string, flags: string): string | null {
  const f = flags ? ` ${flags}` : "";
  if (mgr === "npm") {
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
  if (mgr === "pip") {
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
  if (mgr === "cargo") {
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
  return null;
}
