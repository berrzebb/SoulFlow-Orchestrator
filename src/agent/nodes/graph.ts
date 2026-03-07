/** Graph 노드 핸들러 — 워크플로우에서 그래프 알고리즘 실행. */

import type { NodeHandler } from "../node-registry.js";
import type { GraphNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const graph_handler: NodeHandler = {
  node_type: "graph",
  icon: "\u{1F578}\u{FE0F}",
  color: "#1a237e",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "Graph algorithm result" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "shortest_path / bfs / dfs / topological_sort / connected_components / cycle_detect / mst" },
    { name: "edges", type: "string", description: "JSON array of edges" },
    { name: "start", type: "string", description: "Start node" },
    { name: "end_node", type: "string", description: "End node for shortest_path" },
  ],
  create_default: () => ({ action: "bfs", edges: "[]", start: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as GraphNodeDefinition;
    try {
      const { GraphTool } = await import("../tools/graph.js");
      const tool = new GraphTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "bfs",
        edges: n.edges ? resolve_templates(n.edges, tpl) : undefined,
        start: n.start ? resolve_templates(n.start, tpl) : undefined,
        end: n.end_node ? resolve_templates(n.end_node, tpl) : undefined,
      });
      return { output: { result: JSON.parse(result) } };
    } catch {
      return { output: { result: null } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as GraphNodeDefinition;
    const warnings: string[] = [];
    if (!n.action) warnings.push("action is required");
    if (!n.edges) warnings.push("edges is required");
    return { preview: { action: n.action }, warnings };
  },
};
