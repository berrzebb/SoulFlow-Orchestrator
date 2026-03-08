import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function SshEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.ssh.description")}</label>
        <p className="builder-hint">{t("node.ssh.hint")}</p>
      </div>
    </>
  );
}

export const ssh_descriptor: FrontendNodeDescriptor = {
  node_type: "ssh",
  icon: "🖥️",
  color: "#37474f",
  shape: "rect",
  toolbar_label: "node.ssh.label",
  category: "integration",
  output_schema: [
    { name: "result", type: "string", description: "node.ssh.output.result" },
    { name: "success", type: "boolean", description: "node.ssh.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.ssh.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: SshEditPanel,
};
