import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function MergeEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <BuilderField
      label={t("workflows.merge_mode")}
      hint={String(node.merge_mode || "wait_all") === "collect"
        ? (t("workflows.merge_collect_hint"))
        : String(node.merge_mode || "wait_all") === "first_completed"
          ? (t("workflows.merge_first_hint"))
          : (t("workflows.merge_wait_all_hint"))}
    >
      <select autoFocus className="input input--sm" value={String(node.merge_mode || "wait_all")} onChange={(e) => update({ merge_mode: e.target.value })}>
        <option value="wait_all">{t("workflows.merge_mode_wait_all")}</option>
        <option value="first_completed">{t("workflows.merge_mode_first_completed")}</option>
        <option value="collect">{t("workflows.merge_mode_collect")}</option>
      </select>
    </BuilderField>
  );
}

export const merge_descriptor: FrontendNodeDescriptor = {
  node_type: "merge",
  icon: "⊕",
  color: "#9b59b6",
  shape: "diamond",
  toolbar_label: "node.merge.label",
  category: "flow",
  output_schema: [
    { name: "merged", type: "object", description: "node.merge.output.merged" },
  ],
  input_schema: [],
  create_default: () => ({ merge_mode: "wait_all" }),
  EditPanel: MergeEditPanel,
};
