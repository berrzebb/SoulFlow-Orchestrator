/** Gate (K-of-N 조건부 진행) 노드 핸들러. N개 입력 중 K개 완료 시 진행. */

import type { NodeHandler } from "../node-registry.js";
import type { GateNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";

export const gate_handler: NodeHandler = {
  node_type: "gate",
  icon: "🚧",
  color: "#607d8b",
  shape: "diamond",
  output_schema: [
    { name: "completed",   type: "array",   description: "Completed source node IDs" },
    { name: "pending",     type: "array",   description: "Still-pending source node IDs" },
    { name: "results",     type: "object",  description: "Results from completed sources" },
    { name: "quorum_met",  type: "boolean", description: "Whether quorum was met" },
  ],
  input_schema: [
    { name: "sources", type: "array", description: "Source node results" },
  ],
  create_default: () => ({
    quorum: 1,
    timeout_ms: 300_000,
    on_timeout: "proceed" as const,
  }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as GateNodeDefinition;
    const sources = n.depends_on || [];
    const completed: string[] = [];
    const pending: string[] = [];
    const results: Record<string, unknown> = {};

    for (const src of sources) {
      const val = (ctx.memory as Record<string, unknown>)[src];
      if (val !== undefined) {
        completed.push(src);
        results[src] = val;
      } else {
        pending.push(src);
      }
    }

    const quorum_met = completed.length >= (n.quorum ?? 1);
    return {
      output: { completed, pending, results, quorum_met },
    };
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as GateNodeDefinition;
    const warnings: string[] = [];
    const sources = n.depends_on || [];
    if (sources.length === 0) warnings.push("depends_on is empty — gate needs source nodes");
    if ((n.quorum ?? 1) > sources.length) warnings.push("quorum exceeds number of source nodes");
    if ((n.quorum ?? 1) < 1) warnings.push("quorum must be at least 1");
    return {
      preview: { quorum: n.quorum, sources: sources.length, on_timeout: n.on_timeout },
      warnings,
    };
  },
};
