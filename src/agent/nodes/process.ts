/** Process 노드 핸들러 — 워크플로우에서 프로세스 관리. */

import type { NodeHandler } from "../node-registry.js";
import type { ProcessNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { run_shell_command } from "../tools/shell-runtime.js";
import { error_message } from "../../utils/common.js";

const IS_WIN = process.platform === "win32";

export const process_handler: NodeHandler = {
  node_type: "process",
  icon: "\u{2699}",
  color: "#607d8b",
  shape: "rect",
  output_schema: [
    { name: "output",  type: "string",  description: "Command output" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
    { name: "pid",     type: "number",  description: "Process ID (for start)" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "list / start / stop / info" },
    { name: "command",   type: "string", description: "Command to start" },
    { name: "pid",       type: "number", description: "Process ID" },
  ],
  create_default: () => ({ operation: "list", command: "", pid: 0, signal: "SIGTERM", filter: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as ProcessNodeDefinition;
    const tpl = { memory: ctx.memory };
    const op = resolve_templates(n.operation || "list", tpl);

    const cwd = ctx.workspace;
    try {
      switch (op) {
        case "list": {
          const filter = resolve_templates(n.filter || "", tpl);
          const cmd = IS_WIN
            ? (filter ? `tasklist /fi "imagename eq *${filter}*"` : "tasklist")
            : (filter
              ? `ps aux | head -1 && ps aux | grep -i "${filter}" | grep -v grep`
              : "ps aux | head -30");
          const shell_opts = { cwd, max_buffer_bytes: 1024 * 1024 };
          const { stdout } = await run_shell_command(cmd, { ...shell_opts, timeout_ms: 10_000, signal: ctx.abort_signal });
          return { output: { output: stdout?.trim() || "(no processes)", success: true } };
        }
        case "start": {
          const command = resolve_templates(n.command || "", tpl).trim();
          if (!command) return { output: { output: "", success: false, error: "command required" } };
          const shell_opts = { cwd, max_buffer_bytes: 1024 * 1024 };
          const start_cmd = IS_WIN
            ? `start /b ${command}`
            : `${command} &\necho "PID: $!"`;
          const { stdout } = await run_shell_command(start_cmd, { ...shell_opts, timeout_ms: 10_000, signal: ctx.abort_signal });
          return { output: { output: stdout?.trim() || "started", success: true } };
        }
        case "stop": {
          const pid = Number(n.pid || 0);
          if (!pid) return { output: { output: "", success: false, error: "pid required" } };
          const sig = n.signal || "SIGTERM";
          const shell_opts = { cwd, max_buffer_bytes: 1024 * 64 };
          const stop_cmd = IS_WIN
            ? `taskkill /pid ${pid} /f`
            : `kill -s ${sig} ${pid}`;
          await run_shell_command(stop_cmd, { ...shell_opts, timeout_ms: 5_000, signal: ctx.abort_signal });
          return { output: { output: `Signal ${sig} sent to PID ${pid}`, success: true, pid } };
        }
        case "info": {
          const pid = Number(n.pid || 0);
          if (!pid) return { output: { output: "", success: false, error: "pid required" } };
          const shell_opts = { cwd, max_buffer_bytes: 1024 * 64 };
          const info_cmd = IS_WIN
            ? `tasklist /fi "pid eq ${pid}" /v`
            : `ps -p ${pid} -o pid,ppid,user,%cpu,%mem,etime,command`;
          const { stdout } = await run_shell_command(info_cmd, { ...shell_opts, timeout_ms: 5_000, signal: ctx.abort_signal });
          return { output: { output: stdout?.trim() || `PID ${pid} not found`, success: true, pid } };
        }
        default:
          return { output: { output: "", success: false, error: `unsupported operation: ${op}` } };
      }
    } catch (err) {
      return { output: { output: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as ProcessNodeDefinition;
    const warnings: string[] = [];
    if (!n.operation) warnings.push("operation is required");
    if (n.operation === "start" && !n.command?.trim()) warnings.push("command required for start");
    if ((n.operation === "stop" || n.operation === "info") && !n.pid) warnings.push("pid required");
    return { preview: { operation: n.operation, command: n.command, pid: n.pid }, warnings };
  },
};
