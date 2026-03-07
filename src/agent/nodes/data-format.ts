/** DataFormat 노드 핸들러 — 워크플로우에서 데이터 포맷 변환. */

import type { NodeHandler } from "../node-registry.js";
import type { DataFormatNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const data_format_handler: NodeHandler = {
  node_type: "data_format",
  icon: "\u{1F504}",
  color: "#00838f",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "string",  description: "Converted/queried data" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "convert/query/flatten/merge/pick/omit" },
    { name: "input",     type: "string", description: "Input data" },
    { name: "from",      type: "string", description: "Source format" },
    { name: "to",        type: "string", description: "Target format" },
  ],
  create_default: () => ({ operation: "convert", input: "", from: "json", to: "csv", path: "", keys: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as DataFormatNodeDefinition;
    const tpl = { memory: ctx.memory };
    const input = resolve_templates(n.input || "", tpl);
    const op = resolve_templates(n.operation || "convert", tpl);

    try {
      const { DataFormatTool } = await import("../tools/data-format.js");
      const tool = new DataFormatTool();
      const result = await tool.execute({
        operation: op,
        input,
        from: n.from || "json",
        to: n.to || "json",
        path: n.path || "",
        keys: n.keys || "",
        input2: resolve_templates(n.input2 || "", tpl),
        delimiter: n.delimiter || ",",
      });
      const is_error = result.startsWith("Error:");
      return { output: { result, success: !is_error } };
    } catch (err) {
      return { output: { result: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as DataFormatNodeDefinition;
    const warnings: string[] = [];
    if (!n.input?.trim()) warnings.push("input is required");
    if (n.operation === "convert" && n.from === n.to) warnings.push("from and to formats are the same");
    return { preview: { operation: n.operation, from: n.from, to: n.to }, warnings };
  },
};
