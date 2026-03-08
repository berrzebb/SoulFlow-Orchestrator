import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function FtpEditPanel({ t }: EditPanelProps) {
  return (
    <BuilderField label={t("node.ftp.description")} hint={t("node.ftp.hint")}>
      {null}
    </BuilderField>
  );
}

export const ftp_descriptor: FrontendNodeDescriptor = {
  node_type: "ftp",
  icon: "📤",
  color: "#3f51b5",
  shape: "rect",
  toolbar_label: "node.ftp.label",
  category: "integration",
  output_schema: [
    { name: "result", type: "string", description: "node.ftp.output.result" },
    { name: "success", type: "boolean", description: "node.ftp.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.ftp.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: FtpEditPanel,
};
