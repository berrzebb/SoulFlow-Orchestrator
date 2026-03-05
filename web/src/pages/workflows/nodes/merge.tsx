import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function MergeEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <div className="builder-row">
      <label className="label">{t("workflows.merge_mode")}</label>
      <select className="input input--sm" value={String(node.merge_mode || "wait_all")} onChange={(e) => update({ merge_mode: e.target.value })}>
        <option value="wait_all">wait_all</option>
        <option value="first_completed">first_completed</option>
      </select>
    </div>
  );
}

export const merge_descriptor: FrontendNodeDescriptor = {
  node_type: "merge",
  icon: "⊕",
  color: "#9b59b6",
  shape: "diamond",
  toolbar_label: "+ Merge",
  output_schema: [
    { name: "merged", type: "object", description: "Collected upstream outputs" },
  ],
  input_schema: [],
  create_default: () => ({ merge_mode: "wait_all" }),
  EditPanel: MergeEditPanel,
};
