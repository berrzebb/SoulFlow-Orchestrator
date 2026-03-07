/** Password 노드 핸들러 — 워크플로우에서 패스워드 강도 분석/생성/해싱. */

import type { NodeHandler } from "../node-registry.js";
import type { PasswordNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const password_handler: NodeHandler = {
  node_type: "password",
  icon: "\u{1F511}",
  color: "#c62828",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "Password operation result" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "strength / generate / hash / verify / check_policy" },
    { name: "password", type: "string", description: "Password to analyze/hash" },
  ],
  create_default: () => ({ action: "generate", length: 16 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as PasswordNodeDefinition;
    try {
      const { PasswordTool } = await import("../tools/password.js");
      const tool = new PasswordTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "generate",
        password: n.password_input ? resolve_templates(n.password_input, tpl) : undefined,
        length: n.length,
        hash: n.hash ? resolve_templates(n.hash, tpl) : undefined,
      });
      return { output: { result: JSON.parse(result) } };
    } catch {
      return { output: { result: null } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as PasswordNodeDefinition;
    const warnings: string[] = [];
    if (n.action === "strength" && !n.password_input) warnings.push("password_input is required for strength check");
    return { preview: { action: n.action }, warnings };
  },
};
