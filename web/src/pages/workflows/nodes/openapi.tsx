import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function OpenapiEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <BuilderField label={t("node.openapi.description")} hint={t("node.openapi.hint")}>
      {null}
    </BuilderField>
  );
}

export const openapi_descriptor: FrontendNodeDescriptor = {
  node_type: "openapi",
  icon: "📖",
  color: "#43a047",
  shape: "rect",
  toolbar_label: "node.openapi.label",
  category: "integration",
  output_schema: [
    { name: "result", type: "string", description: "node.openapi.output.result" },
    { name: "success", type: "boolean", description: "node.openapi.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.openapi.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: OpenapiEditPanel,
};
