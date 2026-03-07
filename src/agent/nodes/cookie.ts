/** Cookie 노드 핸들러 — 워크플로우에서 쿠키 파싱/생성. */

import type { NodeHandler } from "../node-registry.js";
import type { CookieNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const cookie_handler: NodeHandler = {
  node_type: "cookie",
  icon: "\u{1F36A}",
  color: "#8d6e63",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "Cookie operation result" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "parse / serialize / build_set_cookie / validate / jar_merge" },
    { name: "input", type: "string", description: "Cookie string or JSON" },
  ],
  create_default: () => ({ action: "parse", input: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as CookieNodeDefinition;
    try {
      const { CookieTool } = await import("../tools/cookie.js");
      const tool = new CookieTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "parse",
        input: n.input ? resolve_templates(n.input, tpl) : undefined,
        name: n.cookie_name ? resolve_templates(n.cookie_name, tpl) : undefined,
        value: n.cookie_value ? resolve_templates(n.cookie_value, tpl) : undefined,
      });
      return { output: { result: JSON.parse(result) } };
    } catch {
      return { output: { result: null } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as CookieNodeDefinition;
    const warnings: string[] = [];
    if (!n.action) warnings.push("action is required");
    return { preview: { action: n.action }, warnings };
  },
};
