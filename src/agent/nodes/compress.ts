/** Compress 노드 핸들러 — 워크플로우에서 파일/문자열 압축·해제. */

import type { NodeHandler } from "../node-registry.js";
import type { CompressNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const compress_handler: NodeHandler = {
  node_type: "compress",
  icon: "\u{1F4E6}",
  color: "#558b2f",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "string",  description: "Compression result" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "operation",  type: "string", description: "compress/decompress/compress_string/decompress_string" },
    { name: "input_path", type: "string", description: "Input file path" },
  ],
  create_default: () => ({ operation: "compress", input_path: "", output_path: "", input: "", algorithm: "gzip", level: 6 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as CompressNodeDefinition;
    try {
      const { CompressTool } = await import("../tools/compress.js");
      const tool = new CompressTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        operation: n.operation || "compress",
        input_path: resolve_templates(n.input_path || "", tpl),
        output_path: resolve_templates(n.output_path || "", tpl),
        input: resolve_templates(n.input || "", tpl),
        algorithm: n.algorithm || "gzip",
        level: n.level ?? 6,
      });
      return { output: { result, success: !result.startsWith("Error:") } };
    } catch (err) {
      return { output: { result: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as CompressNodeDefinition;
    const warnings: string[] = [];
    const is_file_op = n.operation === "compress" || n.operation === "decompress";
    if (is_file_op && !n.input_path?.trim()) warnings.push("input_path is required for file operations");
    if (!is_file_op && !n.input?.trim()) warnings.push("input is required for string operations");
    return { preview: { operation: n.operation, algorithm: n.algorithm }, warnings };
  },
};
