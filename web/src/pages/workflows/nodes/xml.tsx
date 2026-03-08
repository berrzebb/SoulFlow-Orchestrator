import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function XmlEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.xml.description")}</label>
        <p className="builder-hint">{t("node.xml.hint")}</p>
      </div>
    </>
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
