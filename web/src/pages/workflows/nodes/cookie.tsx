import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function CookieEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <BuilderField label={t("node.cookie.description")} hint={t("node.cookie.hint")}>
      {null}
    </BuilderField>
  );
}

export const cookie_descriptor: FrontendNodeDescriptor = {
  node_type: "cookie",
  icon: "🍪",
  color: "#8d6e63",
  shape: "rect",
  toolbar_label: "node.cookie.label",
  category: "integration",
  output_schema: [
    { name: "result", type: "string", description: "node.cookie.output.result" },
    { name: "success", type: "boolean", description: "node.cookie.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.cookie.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: CookieEditPanel,
};
