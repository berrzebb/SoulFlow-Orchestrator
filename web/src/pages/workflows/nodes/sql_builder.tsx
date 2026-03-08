import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function SqlBuilderEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <BuilderField label={t("node.sql_builder.description")} hint={t("node.sql_builder.hint")}>
      {null}
    </BuilderField>
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
