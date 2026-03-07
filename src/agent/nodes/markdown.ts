/** Markdown 노드 핸들러 — 워크플로우에서 마크다운 생성. */

import type { NodeHandler } from "../node-registry.js";
import type { MarkdownNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const markdown_handler: NodeHandler = {
  node_type: "markdown",
  icon: "\u{1F4DD}",
  color: "#263238",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "string",  description: "Generated markdown" },
    { name: "success", type: "boolean", description: "Whether generation succeeded" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "table/list/checklist/toc/html_to_md/..." },
    { name: "data",      type: "string", description: "Input data" },
  ],
  create_default: () => ({ operation: "table", data: "", text: "", columns: "", ordered: false }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as MarkdownNodeDefinition;
    try {
      const { MarkdownTool } = await import("../tools/markdown.js");
      const tool = new MarkdownTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        operation: n.operation || "table",
        data: resolve_templates(n.data || "", tpl),
        text: resolve_templates(n.text || "", tpl),
        columns: n.columns, align: n.align,
        ordered: n.ordered,
        label: n.label, url: n.url, color: n.color,
        alt: n.alt, language: n.language, code: n.code,
        summary: n.summary,
      });
      return { output: { result, success: !result.startsWith("Error:") } };
    } catch (err) {
      return { output: { result: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as MarkdownNodeDefinition;
    return { preview: { operation: n.operation }, warnings: [] };
  },
};
