import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function YamlEditPanel({ t }: EditPanelProps) {
  return (
    <BuilderField label={t("node.yaml.description")} hint={t("node.yaml.hint")}>
      {null}
    </BuilderField>
  );
}

export const yaml_descriptor: FrontendNodeDescriptor = {
  node_type: "yaml",
  icon: "📃",
  color: "#9e9e9e",
  shape: "rect",
  toolbar_label: "node.yaml.label",
  category: "data",
  output_schema: [
    { name: "result", type: "string", description: "node.yaml.output.result" },
    { name: "success", type: "boolean", description: "node.yaml.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.yaml.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: YamlEditPanel,
};
