import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function HtmlEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <BuilderField label={t("node.html.description")} hint={t("node.html.hint")}>
      {null}
    </BuilderField>
  );
}

export const html_descriptor: FrontendNodeDescriptor = {
  node_type: "html",
  icon: "🌐",
  color: "#e44d26",
  shape: "rect",
  toolbar_label: "node.html.label",
  category: "integration",
  output_schema: [
    { name: "result", type: "string", description: "node.html.output.result" },
    { name: "success", type: "boolean", description: "node.html.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.html.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: HtmlEditPanel,
};
