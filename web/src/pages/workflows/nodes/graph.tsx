import { BuilderField, BuilderRowPair, JsonField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["bfs", "dfs", "shortest_path", "topological_sort", "connected_components", "cycle_detect", "mst"];

function GraphEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "bfs");
  const needs_endpoints = ["bfs", "dfs", "shortest_path"].includes(action);
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
          {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </BuilderField>
      <JsonField label={t("workflows.graph_edges_json")} value={node.edges} onUpdate={(v) => update({ edges: v })} placeholder="[[1,2],[2,3]]" />
      {needs_endpoints && (
        action === "shortest_path" ? (
          <BuilderRowPair>
            <BuilderField label={t("workflows.graph_start_node")} required>
              <input className="input input--sm" required value={String(node.start ?? "")} onChange={(e) => update({ start: e.target.value })} placeholder="1" aria-required="true" />
            </BuilderField>
            <BuilderField label={t("workflows.graph_end_node")} required>
              <input className="input input--sm" required value={String(node.end_node ?? "")} onChange={(e) => update({ end_node: e.target.value })} placeholder="3" aria-required="true" />
            </BuilderField>
          </BuilderRowPair>
        ) : (
          <BuilderField label={t("workflows.graph_start_node")} required>
            <input className="input input--sm" required value={String(node.start ?? "")} onChange={(e) => update({ start: e.target.value })} placeholder="1" aria-required="true" />
          </BuilderField>
        )
      )}
    </>
  );
}

export const graph_descriptor: FrontendNodeDescriptor = {
  node_type: "graph",
  icon: "🕸️",
  color: "#1a237e",
  shape: "rect",
  toolbar_label: "node.graph.label",
  category: "advanced",
  output_schema: [
    { name: "result", type: "object", description: "node.graph.output.result" },
    { name: "success", type: "boolean", description: "node.graph.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.graph.input.action" },
    { name: "edges", type: "string", description: "node.graph.input.edges" },
  ],
  create_default: () => ({ action: "bfs", edges: "", start: "", end_node: "" }),
  EditPanel: GraphEditPanel,
};
