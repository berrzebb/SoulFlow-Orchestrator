import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function JsonSchemaEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.json_schema.description")}</label>
        <p className="builder-hint">{t("node.json_schema.hint")}</p>
      </div>
    </>
  );
}

export const json_schema_descriptor: FrontendNodeDescriptor = {
  node_type: "json_schema",
  icon: "📋",
  color: "#5c6bc0",
  shape: "rect",
  toolbar_label: "node.json_schema.label",
  category: "data",
  output_schema: [
    { name: "result", type: "string", description: "node.json_schema.output.result" },
    { name: "success", type: "boolean", description: "node.json_schema.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.json_schema.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: JsonSchemaEditPanel,
};
