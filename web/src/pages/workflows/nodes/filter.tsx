import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

function FilterEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("workflows.filter_array")}>
        <input autoFocus className="input input--sm" value={String(node.array_field || "")} onChange={(e) => update({ array_field: e.target.value })} placeholder="body.users" />
      </BuilderField>
      <BuilderField label={t("workflows.filter_condition")} hint={t("workflows.filter_hint")}>
        <textarea className="input code-textarea" rows={3} value={String(node.condition || "")} onChange={(e) => update({ condition: e.target.value })} spellCheck={false} placeholder="item.active === true" />
      </BuilderField>
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
    { name: "array_field", type: "string", description: "node.filter.input.array_field" },
    { name: "condition",   type: "string", description: "node.filter.input.condition" },
  ],
  create_default: () => ({ condition: "true", array_field: "items" }),
  EditPanel: FilterEditPanel,
};
