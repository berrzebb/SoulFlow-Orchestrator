import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function MatrixEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <BuilderField label={t("node.matrix.description")} hint={t("node.matrix.hint")}>
      {null}
    </BuilderField>
  );
}

export const matrix_descriptor: FrontendNodeDescriptor = {
  node_type: "matrix",
  icon: "🧮",
  color: "#4527a0",
  shape: "rect",
  toolbar_label: "node.matrix.label",
  category: "advanced",
  output_schema: [
    { name: "result", type: "string", description: "node.matrix.output.result" },
    { name: "success", type: "boolean", description: "node.matrix.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.matrix.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: MatrixEditPanel,
};
