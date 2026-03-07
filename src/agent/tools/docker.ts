/** Docker 도구 — 컨테이너 라이프사이클 관리. */

import { Tool } from "./base.js";
import { run_shell_command } from "./shell-runtime.js";
import { error_message } from "../../utils/common.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

const BLOCKED_MOUNT_PATTERNS = [
  /--privileged/i,
  /-v\s+\/:/,
  /--pid\s+host/i,
  /--net\s+host/i,
];

export class DockerTool extends Tool {
  readonly name = "docker";
  readonly category = "shell" as const;
  readonly policy_flags = { write: true } as const;
  readonly description = "Manage Docker containers: ps, run, stop, rm, logs, exec, images.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["ps", "run", "stop", "rm", "logs", "exec", "images", "inspect"],
        description: "Docker operation",
      },
      container: { type: "string", description: "Container name or ID" },
      image: { type: "string", description: "Image name (for 'run')" },
      command: { type: "string", description: "Command to run inside container (for 'run'/'exec')" },
      args: { type: "string", description: "Additional docker arguments" },
      tail: { type: "integer", minimum: 1, maximum: 500, description: "Number of log lines (for 'logs')" },
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
    const op = String(params.operation || "ps");
    const container = String(params.container || "").trim();
    const image = String(params.image || "").trim();
    const command = String(params.command || "").trim();
    const extra_args = String(params.args || "").trim();
    const tail = Math.max(1, Math.min(500, Number(params.tail || 50)));

    if (context?.signal?.aborted) return "Error: cancelled";

    const cmd = this.build_command(op, container, image, command, extra_args, tail);
    if (!cmd) return `Error: unsupported operation "${op}" or missing required params`;

    for (const pat of BLOCKED_MOUNT_PATTERNS) {
      if (pat.test(cmd)) return "Error: blocked by safety policy (privileged/host access)";
    }

    try {
      const { stdout, stderr } = await run_shell_command(cmd, {
        cwd: this.workspace,
        timeout_ms: 60_000,
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

  private build_command(op: string, container: string, image: string, command: string, args: string, tail: number): string | null {
    switch (op) {
      case "ps":      return `docker ps -a ${args}`.trim();
      case "images":  return `docker images ${args}`.trim();
      case "run":     return image ? `docker run ${args} ${image} ${command}`.trim() : null;
      case "stop":    return container ? `docker stop ${container}` : null;
      case "rm":      return container ? `docker rm ${container}` : null;
      case "logs":    return container ? `docker logs --tail ${tail} ${container}` : null;
      case "exec":    return (container && command) ? `docker exec ${args} ${container} ${command}`.trim() : null;
      case "inspect": return container ? `docker inspect ${container}` : null;
      default: return null;
    }
  }
}
