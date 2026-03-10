/** Validator 노드 핸들러 — 데이터 검증 (JSON Schema, 포맷, 룰). */

import type { NodeHandler } from "../node-registry.js";
import type { ValidatorNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const validator_handler: NodeHandler = {
  node_type: "validator",
  icon: "\u{2705}",
  color: "#2e7d32",
  shape: "diamond",
  output_schema: [
    { name: "valid",       type: "boolean", description: "Whether data passed validation" },
    { name: "error_count", type: "number",  description: "Number of validation errors" },
    { name: "errors",      type: "array",   description: "Validation errors" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "schema/format/rules/email" },
    { name: "input",     type: "string", description: "Data to validate" },
  ],
  create_default: () => ({ operation: "format", input: "", format: "json", schema: "{}", rules: "[]", email_action: "validate" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as ValidatorNodeDefinition;
    const input = resolve_templates(n.input || "", { memory: ctx.memory });
    try {
      if (n.operation === "email") {
        const { EmailValidateTool } = await import("../tools/email-validate.js");
        const tool = new EmailValidateTool();
        const email_action = n.email_action || "validate";
        const raw = await tool.execute({ action: email_action, email: input, emails: input });
        const parsed = JSON.parse(raw);
        if (email_action === "validate") {
          const err_msgs = (parsed.errors || []) as string[];
          return { output: { valid: parsed.valid, error_count: err_msgs.length, errors: err_msgs.map((m: string) => ({ path: "email", message: m })) } };
        }
        // parse/normalize/check_disposable/check_free/bulk_validate — 결과 직접 노출
        return { output: { valid: !parsed.error, error_count: parsed.error ? 1 : 0, errors: parsed.error ? [{ path: "email", message: parsed.error }] : [], ...parsed } };
      }

      const { ValidatorTool } = await import("../tools/validator.js");
      const tool = new ValidatorTool();
      const result = await tool.execute({
        operation: n.operation || "format",
        input,
        format: n.format || "json",
        schema: n.schema || "{}",
        rules: n.rules || "[]",
      });
      const parsed = JSON.parse(result);
      return { output: parsed };
    } catch (err) {
      return { output: { valid: false, error_count: 1, errors: [{ path: "$", message: error_message(err) }] } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as ValidatorNodeDefinition;
    const warnings: string[] = [];
    if (!n.input?.trim()) warnings.push("input is required");
    if (n.operation === "schema" && (!n.schema || n.schema === "{}")) warnings.push("schema is empty");
    return { preview: { operation: n.operation, format: n.format }, warnings };
  },
};
