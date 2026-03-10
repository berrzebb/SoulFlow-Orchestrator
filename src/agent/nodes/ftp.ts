/** FTP 노드 핸들러 — 워크플로우에서 FTP 파일 전송. */

import type { NodeHandler } from "../node-registry.js";
import type { FtpNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const ftp_handler: NodeHandler = {
  node_type: "ftp",
  icon: "\u{1F4E4}",
  color: "#3f51b5",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "FTP operation result" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "list / upload / download / info" },
    { name: "host", type: "string", description: "FTP server hostname" },
  ],
  create_default: () => ({ action: "list", host: "", port: 21, username: "anonymous", password: "", remote_path: "/" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as FtpNodeDefinition;
    try {
      const { FtpTool } = await import("../tools/ftp.js");
      const tool = new FtpTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "list",
        host: resolve_templates(n.host || "", tpl),
        port: n.port || 21,
        username: resolve_templates(n.username || "anonymous", tpl),
        password: resolve_templates(n.password || "", tpl),
        remote_path: resolve_templates(n.remote_path || "/", tpl),
        local_path: n.local_path ? resolve_templates(n.local_path, tpl) : undefined,
      });
      const parsed = result.startsWith("{") ? JSON.parse(result) : {};
      return { output: { result: parsed, success: !result.startsWith("Error:") } };
    } catch {
      return { output: { result: null, success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as FtpNodeDefinition;
    const warnings: string[] = [];
    if (!n.host) warnings.push("host is required");
    return { preview: { action: n.action, host: n.host }, warnings };
  },
};
