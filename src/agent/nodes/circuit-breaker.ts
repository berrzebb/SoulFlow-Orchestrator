/** CircuitBreaker 노드 핸들러 — 워크플로우에서 서킷 브레이커 상태 관리. */

import type { NodeHandler } from "../node-registry.js";
import type { CircuitBreakerNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const circuit_breaker_handler: NodeHandler = {
  node_type: "circuit_breaker",
  icon: "\u{26A1}",
  color: "#e65100",
  shape: "rect",
  output_schema: [
    { name: "state", type: "string", description: "Circuit state: closed / open / half_open" },
    { name: "result", type: "unknown", description: "Full result" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "create / record_success / record_failure / get_state / reset / stats / config" },
    { name: "name", type: "string", description: "Circuit breaker name" },
  ],
  create_default: () => ({ action: "get_state", name: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as CircuitBreakerNodeDefinition;
    try {
      const { CircuitBreakerTool } = await import("../tools/circuit-breaker.js");
      const tool = new CircuitBreakerTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "get_state",
        name: n.name ? resolve_templates(n.name, tpl) : "",
        threshold: n.threshold,
        timeout_ms: n.timeout_ms,
        half_open_max: n.half_open_max,
      });
      const parsed = JSON.parse(result);
      return { output: { state: parsed.state || "", result: parsed } };
    } catch {
      return { output: { state: "unknown", result: null } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as CircuitBreakerNodeDefinition;
    const warnings: string[] = [];
    if (!n.name) warnings.push("name is required");
    return { preview: { action: n.action, name: n.name }, warnings };
  },
};
