import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function SplitEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("workflows.split_array_field")}>
        <input autoFocus className="input input--sm" value={String(node.array_field || "")} onChange={(e) => update({ array_field: e.target.value })} placeholder="body.users" />
      </BuilderField>
      <BuilderField label={t("workflows.split_batch_size")}>
        <input className="input input--sm" type="number" min={1} value={String(node.batch_size ?? 1)} onChange={(e) => update({ batch_size: Number(e.target.value) || 1 })} />
      </BuilderField>
    </>
  );
}

export const split_descriptor: FrontendNodeDescriptor = {
  node_type: "split",
  icon: "↕",
  color: "#16a085",
  shape: "diamond",
  toolbar_label: "node.split.label",
  category: "flow",
  output_schema: [
    { name: "item",  type: "unknown", description: "node.split.output.item" },
    { name: "index", type: "number",  description: "node.split.output.index" },
    { name: "total", type: "number",  description: "node.split.output.total" },
  ],
  input_schema: [
    { name: "array_field", type: "string", description: "node.split.input.array_field" },
    { name: "batch_size",  type: "number", description: "node.split.input.batch_size" },
  ],
  create_default: () => ({ array_field: "", batch_size: 1 }),
  EditPanel: SplitEditPanel,
};
