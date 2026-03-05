import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function SplitEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.split_array_field") || "Array Field"}</label>
        <input className="input input--sm" value={String(node.array_field || "")} onChange={(e) => update({ array_field: e.target.value })} placeholder="body.users" />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.split_batch_size") || "Batch Size"}</label>
        <input className="input input--sm" type="number" min={1} value={String(node.batch_size ?? 1)} onChange={(e) => update({ batch_size: Number(e.target.value) || 1 })} />
      </div>
    </>
  );
}

export const split_descriptor: FrontendNodeDescriptor = {
  node_type: "split",
  icon: "↕",
  color: "#16a085",
  shape: "diamond",
  toolbar_label: "+ Split",
  output_schema: [
    { name: "item",  type: "unknown", description: "Individual array item" },
    { name: "index", type: "number",  description: "Current item index" },
    { name: "total", type: "number",  description: "Total item count" },
  ],
  input_schema: [
    { name: "array", type: "array", description: "Array to split" },
  ],
  create_default: () => ({ array_field: "" }),
  EditPanel: SplitEditPanel,
};
