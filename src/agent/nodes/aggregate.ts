/** Aggregate (집계) 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { AggregateNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";

export const aggregate_handler: NodeHandler = {
  node_type: "aggregate",
  icon: "∑",
  color: "#9c27b0",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "Aggregated result" },
    { name: "count",  type: "number",  description: "Number of items processed" },
  ],
  input_schema: [
    { name: "items", type: "array", description: "Items to aggregate" },
  ],
  create_default: () => ({ operation: "collect", array_field: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as AggregateNodeDefinition;
    const raw = get_nested_value(ctx.memory, n.array_field || "");
    const items = Array.isArray(raw) ? raw : [];
    const op = n.operation || "collect";

    let result: unknown;
    switch (op) {
      case "count":
        result = items.length;
        break;
      case "sum":
        result = items.reduce((acc, v) => acc + (Number(v) || 0), 0);
        break;
      case "avg":
        result = items.length ? items.reduce((acc, v) => acc + (Number(v) || 0), 0) / items.length : 0;
        break;
      case "min":
        result = items.length ? Math.min(...items.map(Number).filter(Number.isFinite)) : null;
        break;
      case "max":
        result = items.length ? Math.max(...items.map(Number).filter(Number.isFinite)) : null;
        break;
      case "join":
        result = items.map(String).join(n.separator ?? "\n");
        break;
      case "unique":
        result = [...new Set(items.map(String))];
        break;
      case "flatten":
        result = items.flat();
        break;
      case "collect":
      default:
        result = items;
        break;
    }

    return { output: { result, count: items.length } };
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as AggregateNodeDefinition;
    const warnings: string[] = [];
    if (!n.array_field?.trim()) warnings.push("array_field is required");
    return { preview: { operation: n.operation, array_field: n.array_field }, warnings };
  },
};

function get_nested_value(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
