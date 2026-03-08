import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function ChangelogEditPanel({ t }: EditPanelProps) {
  return (
    <BuilderField label={t("node.changelog.description")} hint={t("node.changelog.hint")}>
      {null}
    </BuilderField>
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
