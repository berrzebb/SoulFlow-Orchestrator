import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function SshEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <BuilderField label={t("node.ssh.description")} hint={t("node.ssh.hint")}>
      {null}
    </BuilderField>
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
