/** Assert (데이터 검증) 노드 핸들러. 조건 미충족 시 워크플로우 중단. */

import { createContext, runInNewContext } from "node:vm";
import type { NodeHandler } from "../node-registry.js";
import type { AssertNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const assert_handler: NodeHandler = {
  node_type: "assert",
  icon: "🛡",
  color: "#e91e63",
  shape: "diamond",
  output_schema: [
    { name: "valid",    type: "boolean", description: "Whether all assertions passed" },
    { name: "errors",   type: "array",   description: "Validation error messages" },
    { name: "checked",  type: "number",  description: "Number of assertions checked" },
  ],
  input_schema: [
    { name: "data", type: "unknown", description: "Data to validate" },
  ],
  create_default: () => ({
    assertions: [] as Array<Record<string, unknown>>,
    on_fail: "halt" as const,
    error_message: "",
  }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as AssertNodeDefinition;
    const errors: string[] = [];

    for (const assertion of n.assertions || []) {
      try {
        const sandbox = createContext({ memory: ctx.memory });
        const result = runInNewContext(assertion.condition, sandbox, { timeout: 1_000 });
        if (!result) {
          const msg = resolve_templates(
            assertion.message || `Assertion failed: ${assertion.condition}`,
            { memory: ctx.memory },
          );
          errors.push(msg);
        }
      } catch (err) {
        errors.push(`Expression error: ${assertion.condition} — ${error_message(err)}`);
      }
    }

    const valid = errors.length === 0;
    if (!valid && n.on_fail === "halt") {
      const errorMsg = resolve_templates(n.error_message || errors.join("; "), { memory: ctx.memory });
      throw new Error(`Assert failed: ${errorMsg}`);
    }

    return { output: { valid, errors, checked: (n.assertions || []).length } };
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as AssertNodeDefinition;
    const warnings: string[] = [];
    if (!(n.assertions || []).length) warnings.push("at least one assertion is required");
    for (const a of n.assertions || []) {
      if (!a.condition?.trim()) warnings.push("assertion condition is empty");
    }
    return {
      preview: { assertion_count: (n.assertions || []).length, on_fail: n.on_fail },
      warnings,
    };
  },
};
