/** SetOps 노드 핸들러 — 워크플로우에서 집합 연산. */

import type { NodeHandler } from "../node-registry.js";
import type { SetOpsNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const set_ops_handler: NodeHandler = {
  node_type: "set_ops",
  icon: "\u{1F300}",
  color: "#6a1b9a",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "string",  description: "Set operation result" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "union/intersection/difference/..." },
    { name: "a",         type: "string", description: "First set (JSON array)" },
  ],
  create_default: () => ({ operation: "union", a: "", b: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as SetOpsNodeDefinition;
    try {
      const { SetTool } = await import("../tools/set.js");
      const tool = new SetTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        operation: n.operation || "union",
        a: resolve_templates(n.a || "", tpl),
        b: resolve_templates(n.b || "", tpl),
      });
      return { output: { result, success: !result.startsWith("Error:") } };
    } catch (err) {
      return { output: { result: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as SetOpsNodeDefinition;
    const warnings: string[] = [];
    if (!n.a?.trim()) warnings.push("set 'a' is required");
    if (n.operation !== "power_set" && !n.b?.trim()) warnings.push("set 'b' is required for this operation");
    return { preview: { operation: n.operation }, warnings };
  },
};
