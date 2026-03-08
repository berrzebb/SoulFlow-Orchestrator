import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function QrEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.qr.description")}</label>
        <p className="builder-hint">{t("node.qr.hint")}</p>
      </div>
    </>
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
