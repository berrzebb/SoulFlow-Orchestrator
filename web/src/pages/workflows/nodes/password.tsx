import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function PasswordEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.password.description")}</label>
        <p className="builder-hint">{t("node.password.hint")}</p>
      </div>
    </>
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
