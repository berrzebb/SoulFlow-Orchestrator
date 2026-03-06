import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function FilterEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.filter_array") || "Array Field"}</label>
        <input className="input input--sm" value={String(node.array_field || "")} onChange={(e) => update({ array_field: e.target.value })} placeholder="body.users" />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.filter_condition") || "Condition"}</label>
        <textarea className="input code-textarea" rows={3} value={String(node.condition || "")} onChange={(e) => update({ condition: e.target.value })} spellCheck={false} placeholder="item.active === true" />
        <span className="builder-hint">{t("workflows.filter_hint") || "JS expression per item. Available: item, index"}</span>
      </div>
    </>
  );
}

export const filter_descriptor: FrontendNodeDescriptor = {
  node_type: "filter",
  icon: "⊳",
  color: "#1abc9c",
  shape: "rect",
  toolbar_label: "+ Filter",
  category: "flow",
  output_schema: [
    { name: "items",    type: "array",  description: "Filtered items" },
    { name: "count",    type: "number", description: "Filtered item count" },
    { name: "rejected", type: "number", description: "Rejected item count" },
  ],
  input_schema: [
    { name: "array",     type: "array",  description: "Array to filter" },
    { name: "condition", type: "string", description: "JS condition per item" },
  ],
  create_default: () => ({ condition: "true", array_field: "items" }),
  EditPanel: FilterEditPanel,
};
