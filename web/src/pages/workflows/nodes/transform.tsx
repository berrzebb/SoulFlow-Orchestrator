import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function TransformEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.transform_array")}</label>
        <input className="input input--sm" value={String(node.array_field || "")} onChange={(e) => update({ array_field: e.target.value })} placeholder="body.rows" />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.transform_expression")}</label>
        <textarea className="input code-textarea" rows={4} value={String(node.expression || "")} onChange={(e) => update({ expression: e.target.value })} spellCheck={false} placeholder="({ name: item.first + ' ' + item.last, email: item.email })" />
        <span className="builder-hint">{t("workflows.transform_hint")}</span>
      </div>
    </>
  );
}

export const transform_descriptor: FrontendNodeDescriptor = {
  node_type: "transform",
  icon: "⇄",
  color: "#2980b9",
  shape: "rect",
  toolbar_label: "node.transform.label",
  category: "data",
  output_schema: [
    { name: "items", type: "array",  description: "node.transform.output.items" },
    { name: "count", type: "number", description: "node.transform.output.count" },
  ],
  input_schema: [
    { name: "array",      type: "array",  description: "node.transform.input.array" },
    { name: "expression", type: "string", description: "node.transform.input.expression" },
  ],
  create_default: () => ({ expression: "item", array_field: "items" }),
  EditPanel: TransformEditPanel,
};
