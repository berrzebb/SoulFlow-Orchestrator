import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function BarcodeEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <BuilderField label={t("node.barcode.description")} hint={t("node.barcode.hint")}>
      {null}
    </BuilderField>
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
