/** JWT 노드 핸들러 — 워크플로우에서 JWT 생성/검증/디코딩. */

import type { NodeHandler } from "../node-registry.js";
import type { JwtNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const jwt_handler: NodeHandler = {
  node_type: "jwt",
  icon: "\u{1F3AB}",
  color: "#ff6f00",
  shape: "rect",
  output_schema: [
    { name: "token", type: "string", description: "JWT token" },
    { name: "payload", type: "string", description: "Decoded payload JSON" },
    { name: "valid", type: "boolean", description: "Whether token is valid" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "create/verify/decode" },
    { name: "token", type: "string", description: "JWT token string" },
    { name: "secret", type: "string", description: "HMAC secret" },
  ],
  create_default: () => ({ action: "create", token: "", secret: "", payload: "{}", algorithm: "HS256", expires_in: "1h" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as JwtNodeDefinition;
    try {
      const { JwtTool } = await import("../tools/jwt.js");
      const tool = new JwtTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "create",
        token: resolve_templates(n.token || "", tpl),
        secret: resolve_templates(n.secret || "", tpl),
        payload: resolve_templates(n.payload || "{}", tpl),
        algorithm: n.algorithm || "HS256",
        expires_in: n.expires_in || "",
      });
      const parsed = result.startsWith("{") ? JSON.parse(result) : {};
      return { output: { token: parsed.token || "", payload: JSON.stringify(parsed.payload || {}), valid: parsed.valid ?? !result.startsWith("Error:") } };
    } catch (err) {
      return { output: { token: "", payload: "{}", valid: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as JwtNodeDefinition;
    return { preview: { action: n.action, algorithm: n.algorithm }, warnings: [] };
  },
};
