import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function XmlEditPanel({ t }: EditPanelProps) {
  return (
    <BuilderField label={t("node.xml.description")} hint={t("node.xml.hint")}>
      {null}
    </BuilderField>
  );
}

export const xml_descriptor: FrontendNodeDescriptor = {
  node_type: "xml",
  icon: "📝",
  color: "#607d8b",
  shape: "rect",
  toolbar_label: "node.xml.label",
  category: "data",
  output_schema: [
    { name: "result", type: "string", description: "node.xml.output.result" },
    { name: "success", type: "boolean", description: "node.xml.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.xml.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: XmlEditPanel,
};
