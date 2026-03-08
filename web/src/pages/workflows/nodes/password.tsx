import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function PasswordEditPanel({ t }: EditPanelProps) {
  return (
    <BuilderField label={t("node.password.description")} hint={t("node.password.hint")}>
      {null}
    </BuilderField>
  );
}

export const password_descriptor: FrontendNodeDescriptor = {
  node_type: "password",
  icon: "🔑",
  color: "#c62828",
  shape: "rect",
  toolbar_label: "node.password.label",
  category: "advanced",
  output_schema: [
    { name: "result", type: "string", description: "node.password.output.result" },
    { name: "success", type: "boolean", description: "node.password.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.password.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: PasswordEditPanel,
};
