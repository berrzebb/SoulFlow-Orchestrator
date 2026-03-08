import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function SqlBuilderEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.sql_builder.description")}</label>
        <p className="builder-hint">{t("node.sql_builder.hint")}</p>
      </div>
    </>
  );
}

export const sql_builder_descriptor: FrontendNodeDescriptor = {
  node_type: "sql_builder",
  icon: "📊",
  color: "#336791",
  shape: "rect",
  toolbar_label: "node.sql_builder.label",
  category: "data",
  output_schema: [
    { name: "result", type: "string", description: "node.sql_builder.output.result" },
    { name: "success", type: "boolean", description: "node.sql_builder.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.sql_builder.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: SqlBuilderEditPanel,
};
