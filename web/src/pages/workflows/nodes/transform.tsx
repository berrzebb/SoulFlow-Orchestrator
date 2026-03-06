import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function TransformEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.transform_array") || "Array Field"}</label>
        <input className="input input--sm" value={String(node.array_field || "")} onChange={(e) => update({ array_field: e.target.value })} placeholder="body.rows" />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.transform_expression") || "Expression"}</label>
        <textarea className="input code-textarea" rows={4} value={String(node.expression || "")} onChange={(e) => update({ expression: e.target.value })} spellCheck={false} placeholder="({ name: item.first + ' ' + item.last, email: item.email })" />
        <span className="builder-hint">{t("workflows.transform_hint") || "JS expression per item. Return transformed value. Available: item, index"}</span>
      </div>
    </>
  );
}

export const transform_descriptor: FrontendNodeDescriptor = {
  node_type: "transform",
  icon: "⇄",
  color: "#2980b9",
  shape: "rect",
  toolbar_label: "+ Map",
  category: "data",
  output_schema: [
    { name: "items", type: "array",  description: "Transformed items" },
    { name: "count", type: "number", description: "Item count" },
  ],
  input_schema: [
    { name: "array",      type: "array",  description: "Array to transform" },
    { name: "expression", type: "string", description: "JS expression per item" },
  ],
  create_default: () => ({ expression: "item", array_field: "items" }),
  EditPanel: TransformEditPanel,
};
