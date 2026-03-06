/** Promise (행동 약속 관리) 노드 핸들러. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { PromiseNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

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

    return {
      output: {
        action: "pending", record: null, records: [], count: 0,
        _meta: {
          operation: n.operation, scope: n.scope || "global", scope_id: n.scope_id,
          key, value, rationale: n.rationale, priority: n.priority ?? 1,
          tags: n.tags || [], target_id: n.target_id, resolved: true,
        },
      },
    };
  },

  async runner_execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const svc = runner.services?.promise;
    if (!svc) return this.execute(node, ctx);

    const n = node as PromiseNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const key = n.key ? resolve_templates(n.key, tpl_ctx) : "";
    const value = n.value ? resolve_templates(n.value, tpl_ctx) : "";

    try {
      switch (n.operation) {
        case "append": {
          const result = await svc.append({
            scope: n.scope || "global", scope_id: n.scope_id, key, value,
            rationale: n.rationale, priority: n.priority ?? 1,
            tags: n.tags, source: "workflow",
          });
          return { output: { action: result.action, record: result.record, records: [], count: 1 } };
        }
        case "list": {
          const records = await svc.list({
            scope: n.scope || "global", scope_id: n.scope_id, key: key || undefined, status: "active",
          });
          return { output: { action: "listed", record: null, records, count: records.length } };
        }
        case "get_effective": {
          const records = await svc.get_effective({ agent_id: n.scope_id });
          return { output: { action: "get_effective", record: null, records, count: records.length } };
        }
        case "archive": {
          const ok = await svc.archive(n.target_id || "");
          return { output: { action: ok ? "archived" : "not_found", record: null, records: [], count: ok ? 1 : 0 } };
        }
        default:
          return { output: { action: "error", record: null, records: [], count: 0, error: `unknown operation: ${n.operation}` } };
      }
    } catch (err) {
      runner.logger.warn("promise_node_error", { node_id: n.node_id, error: error_message(err) });
      return { output: { action: "error", record: null, records: [], count: 0, error: error_message(err) } };
    }
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
