/** Barcode 노드 핸들러 — 워크플로우에서 바코드 생성. */

import type { NodeHandler } from "../node-registry.js";
import type { BarcodeNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const barcode_handler: NodeHandler = {
  node_type: "barcode",
  icon: "\u{1F4F6}",
  color: "#37474f",
  shape: "rect",
  output_schema: [
    { name: "result", type: "string", description: "Generated barcode SVG or JSON" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "generate / validate_ean / parse_ean / checksum_ean" },
    { name: "data", type: "string", description: "Data to encode" },
  ],
  create_default: () => ({ action: "generate", data: "", format: "code128" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as BarcodeNodeDefinition;
    try {
      const { BarcodeTool } = await import("../tools/barcode.js");
      const tool = new BarcodeTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "generate",
        data: n.data ? resolve_templates(n.data, tpl) : undefined,
        format: n.format,
        width: n.width,
        height: n.height,
      });
      if (result.startsWith("<svg") || result.startsWith("{")) {
        const is_json = result.startsWith("{");
        const parsed = is_json ? JSON.parse(result) : result;
        return { output: { result: parsed, success: is_json ? !parsed.error : true } };
      }
      return { output: { result, success: true } };
    } catch {
      return { output: { result: null, success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as BarcodeNodeDefinition;
    const warnings: string[] = [];
    if (!n.data) warnings.push("data is required");
    return { preview: { action: n.action, format: n.format }, warnings };
  },
};
