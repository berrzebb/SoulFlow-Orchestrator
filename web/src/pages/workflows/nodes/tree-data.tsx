import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

const TREE_ACTIONS = ["traverse", "flatten", "find", "depth", "to_ascii", "from_parent_list", "lca"] as const;
const TRAVERSE_ORDERS = ["pre", "in", "post", "level"] as const;

function TreeDataEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "traverse");
  const needs_tree = ["traverse", "flatten", "find", "depth", "to_ascii", "lca"].includes(action);
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" value={action} onChange={(e) => update({ action: e.target.value })}>
          {TREE_ACTIONS.map((a) => <option key={a} value={a}>{t(`node.action.${a}`)}</option>)}
        </select>
      </BuilderField>
      {needs_tree && (
        <BuilderField label={t("workflows.tree_data_input")} required hint={t("workflows.tree_data_input_hint")}>
          <textarea className="input code-textarea" rows={5} value={String(node.tree || "")} onChange={(e) => update({ tree: e.target.value })} placeholder={'{"id":"root","children":[{"id":"a"},{"id":"b"}]}'} />
        </BuilderField>
      )}
      {action === "traverse" && (
        <BuilderField label={t("workflows.tree_data_order")}>
          <select className="input input--sm" value={String(node.order || "pre")} onChange={(e) => update({ order: e.target.value })}>
            {TRAVERSE_ORDERS.map((o) => <option key={o} value={o}>{t(`node.action.${o}`)}</option>)}
          </select>
        </BuilderField>
      )}
      {action === "find" && (
        <BuilderField label={t("workflows.tree_data_target")} required>
          <input className="input input--sm" value={String(node.target || "")} onChange={(e) => update({ target: e.target.value })} placeholder="node-id" />
        </BuilderField>
      )}
      {action === "lca" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.tree_data_node_a")} required>
            <input className="input input--sm" value={String(node.node_a || "")} onChange={(e) => update({ node_a: e.target.value })} placeholder="node-a" />
          </BuilderField>
          <BuilderField label={t("workflows.tree_data_node_b")} required>
            <input className="input input--sm" value={String(node.node_b || "")} onChange={(e) => update({ node_b: e.target.value })} placeholder="node-b" />
          </BuilderField>
        </BuilderRowPair>
      )}
      {action === "from_parent_list" && (
        <BuilderField label={t("workflows.tree_data_parents")} required hint={t("workflows.tree_data_parents_hint")}>
          <textarea className="input code-textarea" rows={5} value={String(node.parents || "")} onChange={(e) => update({ parents: e.target.value })} placeholder={'[{"id":"root","parent":null},{"id":"a","parent":"root"}]'} />
        </BuilderField>
      )}
    </>
  );
}

export const tree_data_descriptor: FrontendNodeDescriptor = {
  node_type: "tree_data",
  icon: "\u{1F333}",
  color: "#2e7d32",
  shape: "rect",
  toolbar_label: "node.tree_data.label",
  category: "data",
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
  EditPanel: TreeDataEditPanel,
};
