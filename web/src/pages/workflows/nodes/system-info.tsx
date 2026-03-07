import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function SystemInfoEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <div className="builder-row">
      <label className="label">{t("workflows.info_category")}</label>
      <select className="input input--sm" value={String(node.category || "all")} onChange={(e) => update({ category: e.target.value })}>
        {["all", "os", "uptime", "cpu", "memory", "disk", "network"].map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
  );
}

export const system_info_descriptor: FrontendNodeDescriptor = {
  node_type: "system_info",
  icon: "\u{1F4BB}",
  color: "#546e7a",
  shape: "rect",
  toolbar_label: "node.system_info.label",
  category: "integration",
  output_schema: [
    { name: "info",    type: "object",  description: "node.system_info.output.info" },
    { name: "success", type: "boolean", description: "node.system_info.output.success" },
  ],
  input_schema: [
    { name: "category", type: "string", description: "node.system_info.input.category" },
  ],
  create_default: () => ({ category: "all" }),
  EditPanel: SystemInfoEditPanel,
};
