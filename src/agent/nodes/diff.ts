/** Diff 노드 핸들러 — 워크플로우에서 텍스트 비교. */

import type { NodeHandler } from "../node-registry.js";
import type { DiffNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const diff_handler: NodeHandler = {
  node_type: "diff",
  icon: "\u{1F4CB}",
  color: "#37474f",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "string",  description: "Diff output or patch result" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "compare/patch/stats" },
    { name: "old_text",  type: "string", description: "Original text" },
    { name: "new_text",  type: "string", description: "Modified text" },
  ],
  create_default: () => ({ operation: "compare", old_text: "", new_text: "", context_lines: 3 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as DiffNodeDefinition;
    const tpl = { memory: ctx.memory };
    const old_text = resolve_templates(n.old_text || "", tpl);
    const new_text = resolve_templates(n.new_text || "", tpl);

    try {
      const { DiffTool } = await import("../tools/diff.js");
      const tool = new DiffTool();
      const result = await tool.execute({
        operation: n.operation || "compare",
        old_text,
        new_text,
        diff_text: resolve_templates(n.diff_text || "", tpl),
        context_lines: n.context_lines ?? 3,
      });
      return { output: { result, success: !result.startsWith("Error:") } };
    } catch (err) {
      return { output: { result: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as DiffNodeDefinition;
    const warnings: string[] = [];
    if (n.operation === "compare" && !n.old_text?.trim() && !n.new_text?.trim()) warnings.push("old_text and new_text are required");
    if (n.operation === "patch" && !n.diff_text?.trim()) warnings.push("diff_text is required for patch");
    return { preview: { operation: n.operation, context_lines: n.context_lines }, warnings };
  },
};
