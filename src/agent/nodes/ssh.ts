/** SSH 노드 핸들러 — 워크플로우에서 원격 서버 명령 실행. */

import type { NodeHandler } from "../node-registry.js";
import type { SshNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const ssh_handler: NodeHandler = {
  node_type: "ssh",
  icon: "\u{1F5A5}\uFE0F",
  color: "#37474f",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "SSH operation result" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "exec / scp_upload / scp_download / info" },
    { name: "host", type: "string", description: "Remote host (user@host)" },
    { name: "command", type: "string", description: "Remote command" },
  ],
  create_default: () => ({ action: "exec", host: "", command: "", port: 22 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as SshNodeDefinition;
    try {
      const { SshTool } = await import("../tools/ssh.js");
      const tool = new SshTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "exec",
        host: resolve_templates(n.host || "", tpl),
        command: resolve_templates(n.command || "", tpl),
        port: n.port || 22,
        identity_file: n.identity_file ? resolve_templates(n.identity_file, tpl) : undefined,
        timeout_ms: n.timeout_ms,
      });
      const parsed = result.startsWith("{") ? JSON.parse(result) : { stdout: result };
      return { output: { result: parsed, success: parsed.success !== false } };
    } catch {
      return { output: { result: null, success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as SshNodeDefinition;
    const warnings: string[] = [];
    if (!n.host) warnings.push("host is required");
    if (n.action === "exec" && !n.command) warnings.push("command is required for exec");
    return { preview: { action: n.action, host: n.host }, warnings };
  },
};
