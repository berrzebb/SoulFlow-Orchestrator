import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function BarcodeEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.barcode.description")}</label>
        <p className="builder-hint">{t("node.barcode.hint")}</p>
      </div>
    </>
  );
}

export const barcode_descriptor: FrontendNodeDescriptor = {
  node_type: "barcode",
  icon: "📶",
  color: "#37474f",
  shape: "rect",
  toolbar_label: "node.barcode.label",
  category: "data",
  output_schema: [
    { name: "result", type: "string", description: "node.barcode.output.result" },
    { name: "success", type: "boolean", description: "node.barcode.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.barcode.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: BarcodeEditPanel,
};
