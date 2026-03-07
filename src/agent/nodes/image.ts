/** Image 노드 핸들러 — 워크플로우에서 이미지 조작. */

import type { NodeHandler } from "../node-registry.js";
import type { ImageNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const image_handler: NodeHandler = {
  node_type: "image",
  icon: "\u{1F5BC}",
  color: "#d81b60",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "string",  description: "Operation result" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "operation",  type: "string", description: "resize/crop/rotate/convert/info/thumbnail" },
    { name: "input_path", type: "string", description: "Input image path" },
  ],
  create_default: () => ({ operation: "info", input_path: "", output_path: "", width: 800, height: 600, format: "png", quality: 85 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as ImageNodeDefinition;
    try {
      const { ImageTool } = await import("../tools/image.js");
      const tool = new ImageTool({ workspace: ctx.workspace || process.cwd() });
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        operation: n.operation || "info",
        input_path: resolve_templates(n.input_path || "", tpl),
        output_path: resolve_templates(n.output_path || "", tpl),
        width: n.width,
        height: n.height,
        format: n.format,
        quality: n.quality,
        angle: n.angle,
        gravity: n.gravity,
      });
      return { output: { result, success: !result.startsWith("Error:") } };
    } catch (err) {
      return { output: { result: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as ImageNodeDefinition;
    const warnings: string[] = [];
    if (!n.input_path?.trim()) warnings.push("input_path is required");
    return { preview: { operation: n.operation, format: n.format }, warnings };
  },
};
