/** Process Manager 도구 — 프로세스 목록 조회, 시작, 중지. */

import { Tool } from "./base.js";
import { run_shell_command } from "./shell-runtime.js";
import { error_message } from "../../utils/common.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

export class ProcessManagerTool extends Tool {
  readonly name = "process_manager";
  readonly category = "shell" as const;
  readonly policy_flags = { write: true } as const;
  readonly description = "List, start, or stop processes.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: { type: "string", enum: ["list", "start", "stop", "info"], description: "Process operation" },
      command: { type: "string", description: "Command to start (for 'start' operation)" },
      pid: { type: "integer", description: "Process ID (for 'stop'/'info' operation)" },
      signal: { type: "string", description: "Signal to send (default: SIGTERM)" },
      filter: { type: "string", description: "Process name filter (for 'list' operation)" },
    },
    required: ["operation"],
    additionalProperties: false,
  };

  private readonly workspace: string;

  constructor(options?: { workspace?: string }) {
    super();
    this.workspace = options?.workspace || process.cwd();
  }

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const op = String(params.operation || "list");
    if (context?.signal?.aborted) return "Error: cancelled";

    try {
      switch (op) {
        case "list":  return await this.list_processes(String(params.filter || ""), context);
        case "start": return await this.start_process(String(params.command || ""), context);
        case "stop":  return await this.stop_process(Number(params.pid || 0), String(params.signal || "SIGTERM"), context);
        case "info":  return await this.process_info(Number(params.pid || 0), context);
        default: return `Error: unsupported operation "${op}"`;
      }
    } catch (err) {
      return `Error: ${error_message(err)}`;
    }
  }

  private async list_processes(filter: string, context?: ToolExecutionContext): Promise<string> {
    const cmd = filter ? `ps aux | head -1 && ps aux | grep -i "${filter}" | grep -v grep` : "ps aux | head -30";
    const { stdout } = await run_shell_command(cmd, {
      cwd: this.workspace,
      timeout_ms: 10_000,
      max_buffer_bytes: 1024 * 1024,
      signal: context?.signal,
    });
    return stdout?.trim() || "(no processes found)";
  }

  private async start_process(command: string, context?: ToolExecutionContext): Promise<string> {
    if (!command) return "Error: command is required for start operation";
    const { stdout, stderr } = await run_shell_command(`${command} &\necho "PID: $!"`, {
      cwd: this.workspace,
      timeout_ms: 10_000,
      max_buffer_bytes: 1024 * 1024,
      signal: context?.signal,
    });
    return [stdout || "", stderr ? `STDERR: ${stderr}` : ""].filter(Boolean).join("\n").trim() || "Process started";
  }

  private async stop_process(pid: number, signal: string, context?: ToolExecutionContext): Promise<string> {
    if (!pid) return "Error: pid is required for stop operation";
    const allowed_signals = new Set(["SIGTERM", "SIGKILL", "SIGINT", "SIGHUP", "SIGUSR1", "SIGUSR2"]);
    const sig = allowed_signals.has(signal.toUpperCase()) ? signal.toUpperCase() : "SIGTERM";
    const { stdout } = await run_shell_command(`kill -s ${sig} ${pid} && echo "Signal ${sig} sent to PID ${pid}"`, {
      cwd: this.workspace,
      timeout_ms: 5_000,
      max_buffer_bytes: 1024 * 64,
      signal: context?.signal,
    });
    return stdout?.trim() || `Signal ${sig} sent to PID ${pid}`;
  }

  private async process_info(pid: number, context?: ToolExecutionContext): Promise<string> {
    if (!pid) return "Error: pid is required for info operation";
    const { stdout } = await run_shell_command(`ps -p ${pid} -o pid,ppid,user,%cpu,%mem,etime,command`, {
      cwd: this.workspace,
      timeout_ms: 5_000,
      max_buffer_bytes: 1024 * 64,
      signal: context?.signal,
    });
    return stdout?.trim() || `Process ${pid} not found`;
  }
}
