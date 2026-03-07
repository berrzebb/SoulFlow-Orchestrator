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
    { name: "operation", type: "string", description: "schema/format/rules" },
    { name: "input",     type: "string", description: "Data to validate" },
  ],
  create_default: () => ({ operation: "format", input: "", format: "json", schema: "{}", rules: "[]" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as ValidatorNodeDefinition;
    try {
      const { ValidatorTool } = await import("../tools/validator.js");
      const tool = new ValidatorTool();
      const input = resolve_templates(n.input || "", { memory: ctx.memory });
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
