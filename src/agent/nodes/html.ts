/** HTML 노드 핸들러 — 워크플로우에서 HTML 파싱/변환. */

import type { NodeHandler } from "../node-registry.js";
import type { HtmlNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const html_handler: NodeHandler = {
  node_type: "html",
  icon: "\u{1F310}",
  color: "#e44d26",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "HTML operation result" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "extract_text / extract_links / extract_tables / sanitize / to_markdown" },
    { name: "html", type: "string", description: "HTML content" },
  ],
  create_default: () => ({ action: "extract_text", html: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as HtmlNodeDefinition;
    try {
      const { HtmlTool } = await import("../tools/html.js");
      const tool = new HtmlTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "extract_text",
        html: resolve_templates(n.html || "", tpl),
        selector: n.selector ? resolve_templates(n.selector, tpl) : undefined,
      });
      const parsed = result.startsWith("{") ? JSON.parse(result) : { data: result };
      return { output: { result: parsed, success: !result.startsWith("Error:") } };
    } catch {
      return { output: { result: null, success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as HtmlNodeDefinition;
    const warnings: string[] = [];
    if (!n.html) warnings.push("html content is empty");
    return { preview: { action: n.action }, warnings };
  },
};
