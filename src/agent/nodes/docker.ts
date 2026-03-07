/** Docker 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { DockerNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { run_shell_command } from "../tools/shell-runtime.js";
import { error_message } from "../../utils/common.js";

const BLOCKED = [/--privileged/i, /-v\s+\/:/i, /--pid\s+host/i, /--net\s+host/i];

export const docker_handler: NodeHandler = {
  node_type: "docker",
  icon: "\u{1F433}",
  color: "#2496ed",
  shape: "rect",
  output_schema: [
    { name: "output",   type: "string",  description: "Command output" },
    { name: "success",  type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "Docker operation" },
    { name: "container", type: "string", description: "Container name/ID" },
    { name: "image",     type: "string", description: "Image name" },
  ],
  create_default: () => ({ operation: "ps", container: "", image: "", command: "", args: "", tail: 50 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as DockerNodeDefinition;
    const tpl = { memory: ctx.memory };
    const op = resolve_templates(n.operation || "ps", tpl);
    const container = resolve_templates(n.container || "", tpl);
    const image = resolve_templates(n.image || "", tpl);
    const command = resolve_templates(n.command || "", tpl);
    const args = resolve_templates(n.args || "", tpl);
    const tail = n.tail || 50;

    const cmd = build_docker_cmd(op, container, image, command, args, tail);
    if (!cmd) return { output: { output: "", success: false, error: `unsupported: ${op}` } };
    for (const p of BLOCKED) if (p.test(cmd)) return { output: { output: "", success: false, error: "blocked by safety policy" } };

    try {
      const { stdout, stderr } = await run_shell_command(cmd, {
        cwd: ctx.workspace,
        timeout_ms: 60_000,
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
    const n = node as DockerNodeDefinition;
    const warnings: string[] = [];
    if (!n.operation) warnings.push("operation is required");
    if (["stop", "rm", "logs", "exec", "inspect"].includes(n.operation || "") && !n.container) warnings.push("container is required");
    if (n.operation === "run" && !n.image) warnings.push("image is required for run");
    return { preview: { operation: n.operation, container: n.container, image: n.image }, warnings };
  },
};

function build_docker_cmd(op: string, container: string, image: string, command: string, args: string, tail: number): string | null {
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
