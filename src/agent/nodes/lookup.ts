/** Lookup 노드 핸들러 — 워크플로우에서 참조 데이터 조회. */

import type { NodeHandler } from "../node-registry.js";
import type { LookupNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const lookup_handler: NodeHandler = {
  node_type: "lookup",
  icon: "\u{1F50D}",
  color: "#37474f",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "string",  description: "Lookup result" },
    { name: "success", type: "boolean", description: "Whether lookup succeeded" },
  ],
  input_schema: [
    { name: "table", type: "string", description: "http_status/mime_type/country/currency_symbol" },
    { name: "key",   type: "string", description: "Lookup key" },
  ],
  create_default: () => ({ table: "http_status", key: "", reverse: false, list: false }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as LookupNodeDefinition;
    try {
      const { LookupTool } = await import("../tools/lookup.js");
      const tool = new LookupTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        table: n.table || "http_status",
        key: resolve_templates(n.key || "", tpl),
        reverse: n.reverse ?? false,
        list: n.list ?? false,
      });
      return { output: { result, success: !result.startsWith("Error:") && !result.startsWith("Not found:") } };
    } catch (err) {
      return { output: { result: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as LookupNodeDefinition;
    const warnings: string[] = [];
    if (!n.list && !n.key?.trim()) warnings.push("key is required (or enable list mode)");
    return { preview: { table: n.table }, warnings };
  },
};
