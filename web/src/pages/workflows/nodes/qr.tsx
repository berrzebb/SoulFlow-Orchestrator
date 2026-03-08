import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function QrEditPanel({ t }: EditPanelProps) {
  return (
    <BuilderField label={t("node.qr.description")} hint={t("node.qr.hint")}>
      {null}
    </BuilderField>
  );
}

export const qr_descriptor: FrontendNodeDescriptor = {
  node_type: "qr",
  icon: "📱",
  color: "#212121",
  shape: "rect",
  toolbar_label: "node.qr.label",
  category: "data",
  output_schema: [
    { name: "result", type: "string", description: "node.qr.output.result" },
    { name: "success", type: "boolean", description: "node.qr.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.qr.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: QrEditPanel,
};
