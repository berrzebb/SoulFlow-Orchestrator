import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function ChangelogEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.changelog.description")}</label>
        <p className="builder-hint">{t("node.changelog.hint")}</p>
      </div>
    </>
  );
}

export const changelog_descriptor: FrontendNodeDescriptor = {
  node_type: "changelog",
  icon: "📝",
  color: "#1565c0",
  shape: "rect",
  toolbar_label: "node.changelog.label",
  category: "advanced",
  output_schema: [
    { name: "result", type: "string", description: "node.changelog.output.result" },
    { name: "success", type: "boolean", description: "node.changelog.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.changelog.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: ChangelogEditPanel,
};
