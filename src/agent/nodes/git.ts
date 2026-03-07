/** Git 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { GitNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { run_shell_command } from "../tools/shell-runtime.js";
import { error_message } from "../../utils/common.js";

export const git_handler: NodeHandler = {
  node_type: "git",
  icon: "\u{1F500}",
  color: "#f05032",
  shape: "rect",
  output_schema: [
    { name: "stdout",    type: "string",  description: "Command stdout" },
    { name: "exit_code", type: "number",  description: "Exit code" },
    { name: "error",     type: "string",  description: "Error message if failed" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "Git operation" },
    { name: "args",      type: "string", description: "Additional arguments" },
  ],
  create_default: () => ({ operation: "status", args: "", working_dir: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as GitNodeDefinition;
    const tpl = { memory: ctx.memory };
    const op = resolve_templates(n.operation || "status", tpl);
    const args = resolve_templates(n.args || "", tpl);
    const cwd = resolve_templates(n.working_dir || "", tpl) || ctx.workspace;

    const command = build_git_command(op, args);
    if (!command) return { output: { stdout: "", exit_code: 1, error: `unsupported operation: ${op}` } };

    try {
      const { stdout, stderr } = await run_shell_command(command, {
        cwd,
        timeout_ms: 30_000,
        max_buffer_bytes: 1024 * 1024 * 4,
        signal: ctx.abort_signal,
      });
      return { output: { stdout: (stdout || "").trim(), stderr: (stderr || "").trim(), exit_code: 0 } };
    } catch (err) {
      return { output: { stdout: "", exit_code: 1, error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as GitNodeDefinition;
    const warnings: string[] = [];
    if (!n.operation) warnings.push("operation is required");
    return { preview: { operation: n.operation, args: n.args }, warnings };
  },
};

function build_git_command(op: string, args: string): string | null {
  const safe = new Set(["status", "diff", "log", "branch", "stash", "tag", "show", "blame", "shortlog"]);
  const write = new Set(["commit", "push", "pull", "checkout", "merge", "rebase", "add", "reset", "fetch"]);
  if (safe.has(op))  return `git ${op} ${args}`.trim();
  if (write.has(op)) return `git ${op} ${args}`.trim();
  return null;
}
