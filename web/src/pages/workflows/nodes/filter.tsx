import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function FilterEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.filter_array")}</label>
        <input className="input input--sm" value={String(node.array_field || "")} onChange={(e) => update({ array_field: e.target.value })} placeholder="body.users" />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.filter_condition")}</label>
        <textarea className="input code-textarea" rows={3} value={String(node.condition || "")} onChange={(e) => update({ condition: e.target.value })} spellCheck={false} placeholder="item.active === true" />
        <span className="builder-hint">{t("workflows.filter_hint")}</span>
      </div>
    </>
  );
}

export const filter_descriptor: FrontendNodeDescriptor = {
  node_type: "filter",
  icon: "⊳",
  color: "#1abc9c",
  shape: "rect",
  toolbar_label: "node.filter.label",
  category: "flow",
  output_schema: [
    { name: "items",    type: "array",  description: "node.filter.output.items" },
    { name: "count",    type: "number", description: "node.filter.output.count" },
    { name: "rejected", type: "number", description: "node.filter.output.rejected" },
  ],
  input_schema: [
    { name: "array",     type: "array",  description: "node.filter.input.array" },
    { name: "condition", type: "string", description: "node.filter.input.condition" },
  ],
  create_default: () => ({ condition: "true", array_field: "items" }),
  EditPanel: FilterEditPanel,
};
