/** Tree Data 노드 핸들러 — 트리 자료구조 탐색/시각화. */

import type { NodeHandler } from "../node-registry.js";
import type { OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

type TreeDataNodeDef = OrcheNodeDefinition & {
  action?: string;
  tree?: string;
  order?: string;
  target?: string;
  node_a?: string;
  node_b?: string;
  parents?: string;
};

export const tree_data_handler: NodeHandler = {
  node_type: "tree_data",
  icon: "\u{1F333}",
  color: "#2e7d32",
  shape: "rect",
  output_schema: [
    { name: "nodes",  type: "array",   description: "node.tree_data.output.nodes" },
    { name: "count",  type: "number",  description: "node.tree_data.output.count" },
    { name: "found",  type: "boolean", description: "node.tree_data.output.found" },
    { name: "ascii",  type: "string",  description: "node.tree_data.output.ascii" },
    { name: "tree",   type: "object",  description: "node.tree_data.output.tree" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.tree_data.input.action" },
    { name: "tree",   type: "string", description: "node.tree_data.input.tree" },
  ],
  create_default: () => ({
    action: "traverse", tree: "", order: "pre", target: "", node_a: "", node_b: "", parents: "",
  }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as TreeDataNodeDef;
    const tpl = { memory: ctx.memory };
    try {
      const { TreeTool } = await import("../tools/tree.js");
      const tool = new TreeTool();
      const raw = await tool.execute({
        action:  n.action || "traverse",
        tree:    resolve_templates(n.tree    || "", tpl) || undefined,
        order:   n.order   || undefined,
        target:  resolve_templates(n.target  || "", tpl) || undefined,
        node_a:  resolve_templates(n.node_a  || "", tpl) || undefined,
        node_b:  resolve_templates(n.node_b  || "", tpl) || undefined,
        parents: resolve_templates(n.parents || "", tpl) || undefined,
      });
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return { output: parsed };
    } catch (err) {
      return { output: { error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as TreeDataNodeDef;
    const warnings: string[] = [];
    const needs_tree = ["traverse", "flatten", "find", "depth", "to_ascii"];
    if (needs_tree.includes(n.action || "traverse") && !n.tree) warnings.push("tree JSON is required");
    if (n.action === "from_parent_list" && !n.parents) warnings.push("parents JSON array is required");
    if (n.action === "lca") {
      if (!n.node_a) warnings.push("node_a is required for lca");
      if (!n.node_b) warnings.push("node_b is required for lca");
    }
    if (n.action === "find" && !n.target) warnings.push("target node ID is required");
    return { preview: { action: n.action }, warnings };
  },
};
