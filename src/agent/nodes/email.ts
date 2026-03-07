/** Email 노드 핸들러 — 워크플로우에서 이메일 전송. */

import type { NodeHandler } from "../node-registry.js";
import type { EmailNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const email_handler: NodeHandler = {
  node_type: "email",
  icon: "\u2709",
  color: "#1565c0",
  shape: "rect",
  output_schema: [
    { name: "message_id", type: "string", description: "Sent message ID" },
    { name: "success", type: "boolean", description: "Whether send succeeded" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "send" },
    { name: "to", type: "string", description: "Recipient email" },
    { name: "subject", type: "string", description: "Email subject" },
    { name: "body", type: "string", description: "Email body" },
  ],
  create_default: () => ({ action: "send", to: "", from: "", subject: "", body: "", smtp_host: "", smtp_port: 587, smtp_user: "", smtp_pass: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as EmailNodeDefinition;
    try {
      const { EmailTool } = await import("../tools/email.js");
      const tool = new EmailTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: "send",
        to: resolve_templates(n.to || "", tpl),
        from: resolve_templates(n.from || "", tpl),
        subject: resolve_templates(n.subject || "", tpl),
        body: resolve_templates(n.body || "", tpl),
        smtp_host: resolve_templates(n.smtp_host || "", tpl),
        smtp_port: n.smtp_port || 587,
        smtp_user: resolve_templates(n.smtp_user || "", tpl),
        smtp_pass: resolve_templates(n.smtp_pass || "", tpl),
      });
      const parsed = result.startsWith("{") ? JSON.parse(result) : {};
      return { output: { message_id: parsed.message_id || "", success: parsed.ok ?? !result.startsWith("Error:") } };
    } catch (_err) {
      return { output: { message_id: "", success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as EmailNodeDefinition;
    const warnings: string[] = [];
    if (!n.to) warnings.push("to is required");
    if (!n.smtp_host) warnings.push("smtp_host is required");
    return { preview: { to: n.to, subject: n.subject }, warnings };
  },
};
