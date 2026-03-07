/** WebSocket 노드 핸들러 — 워크플로우에서 WebSocket 연결/전송/수신. */

import type { NodeHandler } from "../node-registry.js";
import type { WebSocketNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const websocket_handler: NodeHandler = {
  node_type: "websocket",
  icon: "\u{1F50C}",
  color: "#ff9800",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "Operation result" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "connect / send / receive / close" },
    { name: "url", type: "string", description: "WebSocket URL" },
  ],
  create_default: () => ({ action: "connect", url: "", id: "", message: "", timeout_ms: 5000 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as WebSocketNodeDefinition;
    try {
      const { WebSocketTool } = await import("../tools/websocket.js");
      const tool = new WebSocketTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "connect",
        url: resolve_templates(n.url || "", tpl),
        id: n.id || "",
        message: resolve_templates(n.message || "", tpl),
        timeout_ms: n.timeout_ms || 5000,
      });
      const parsed = result.startsWith("{") ? JSON.parse(result) : {};
      return { output: { result: parsed, success: !result.startsWith("Error:") } };
    } catch {
      return { output: { result: null, success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as WebSocketNodeDefinition;
    const warnings: string[] = [];
    if (n.action === "connect" && !n.url) warnings.push("url is required for connect");
    return { preview: { action: n.action, url: n.url }, warnings };
  },
};
