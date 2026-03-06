/** Shell 노드 핸들러 — 워크플로우에서 쉘 명령 실행. */

import type { NodeHandler } from "../node-registry.js";
import type { ShellNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { run_shell_command } from "../tools/shell-runtime.js";
import { error_message } from "../../utils/common.js";

const BLOCKED_PATTERNS = [
  /\brm\s+-[rf]{1,2}\b/i,
  /\b(mkfs|diskpart|dd\s+if=)/i,
  /\b(shutdown|reboot|poweroff)\b/i,
  /:\(\)\s*\{.*\};\s*:/,
];

export const shell_handler: NodeHandler = {
  node_type: "shell",
  icon: "\u{1F4BB}",
  color: "#2d2d2d",
  shape: "rect",
  output_schema: [
    { name: "stdout",    type: "string", description: "Command stdout" },
    { name: "stderr",    type: "string", description: "Command stderr" },
    { name: "exit_code", type: "number", description: "Exit code" },
  ],
  input_schema: [
    { name: "command", type: "string", description: "Shell command to execute" },
  ],
  create_default: () => ({ command: "", timeout_ms: 30000, working_dir: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as ShellNodeDefinition;
    const tpl = { memory: ctx.memory };
    const command = resolve_templates(n.command || "", tpl).trim();

    if (!command) return { output: { stdout: "", stderr: "", exit_code: 1, error: "command is empty" } };

    for (const pat of BLOCKED_PATTERNS) {
      if (pat.test(command)) return { output: { stdout: "", stderr: "", exit_code: 1, error: "blocked by safety policy" } };
    }

    const cwd = resolve_templates(n.working_dir || "", tpl) || process.cwd();
    const timeout_ms = Math.min(120_000, Math.max(1000, n.timeout_ms || 30_000));

    try {
      const { stdout, stderr } = await run_shell_command(command, {
        cwd,
        timeout_ms,
        max_buffer_bytes: 1024 * 1024 * 8,
        signal: ctx.abort_signal,
      });
      return { output: { stdout: (stdout || "").trim(), stderr: (stderr || "").trim(), exit_code: 0 } };
    } catch (err) {
      const exec_err = err as { stdout?: string; stderr?: string; code?: number };
      return {
        output: {
          stdout: (exec_err.stdout || "").trim(),
          stderr: (exec_err.stderr || "").trim(),
          exit_code: exec_err.code ?? 1,
          error: error_message(err),
        },
      };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as ShellNodeDefinition;
    const warnings: string[] = [];
    if (!n.command?.trim()) warnings.push("command is empty");
    for (const pat of BLOCKED_PATTERNS) {
      if (pat.test(n.command || "")) warnings.push("command contains blocked pattern");
    }
    return { preview: { command: n.command, timeout_ms: n.timeout_ms }, warnings };
  },
};
