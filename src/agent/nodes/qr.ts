/** QR 노드 핸들러 — 워크플로우에서 QR코드 생성. */

import type { NodeHandler } from "../node-registry.js";
import type { QrNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const qr_handler: NodeHandler = {
  node_type: "qr",
  icon: "\u{1F4F1}",
  color: "#212121",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "QR code output (SVG or text)" },
    { name: "success", type: "boolean", description: "Whether generation succeeded" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "Data to encode" },
    { name: "format", type: "string", description: "svg / text" },
  ],
  create_default: () => ({ action: "generate", data: "", format: "svg" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as QrNodeDefinition;
    try {
      const { QrTool } = await import("../tools/qr.js");
      const tool = new QrTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "generate",
        data: resolve_templates(n.data || "", tpl),
        format: n.format || "svg",
        size: n.size,
      });
      const parsed = result.startsWith("{") ? JSON.parse(result) : { output: result };
      return { output: { result: parsed, success: !result.startsWith("Error:") } };
    } catch {
      return { output: { result: null, success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as QrNodeDefinition;
    const warnings: string[] = [];
    if (!n.data) warnings.push("data is required");
    return { preview: { data: n.data?.slice(0, 30), format: n.format }, warnings };
  },
};
