/** Promise (행동 약속 관리) 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { PromiseNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const promise_handler: NodeHandler = {
  node_type: "promise",
  icon: "🤝",
  color: "#009688",
  shape: "rect",
  output_schema: [
    { name: "action",  type: "string", description: "Result action (inserted/deduped/listed)" },
    { name: "record",  type: "object", description: "Promise record" },
    { name: "records", type: "array",  description: "Listed records (list/get_effective)" },
    { name: "count",   type: "number", description: "Record count" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "append | list | get_effective | archive" },
    { name: "key",       type: "string", description: "Promise key" },
    { name: "value",     type: "string", description: "Promise value" },
  ],
  create_default: () => ({ operation: "append", scope: "global", key: "", value: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as PromiseNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const key = n.key ? resolve_templates(n.key, tpl_ctx) : "";
    const value = n.value ? resolve_templates(n.value, tpl_ctx) : "";

    // 실제 PromiseService 호출은 phase-loop-runner가 서비스 주입으로 처리.
    return {
      output: {
        action: "pending",
        record: null,
        records: [],
        count: 0,
        _meta: {
          operation: n.operation,
          scope: n.scope || "global",
          scope_id: n.scope_id,
          key, value,
          rationale: n.rationale,
          priority: n.priority ?? 1,
          tags: n.tags || [],
          target_id: n.target_id,
          resolved: true,
        },
      },
    };
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as PromiseNodeDefinition;
    const warnings: string[] = [];
    if (n.operation === "append" && !n.key) warnings.push("key is required for append");
    if (n.operation === "append" && !n.value) warnings.push("value is required for append");
    if (n.operation === "archive" && !n.target_id) warnings.push("target_id is required for archive");
    return {
      preview: { operation: n.operation, scope: n.scope || "global", key: n.key || "", priority: n.priority ?? 1 },
      warnings,
    };
  },
};
