import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function PdfEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.pdf.description")}</label>
        <p className="builder-hint">{t("node.pdf.hint")}</p>
      </div>
    </>
  );
}

export const pdf_descriptor: FrontendNodeDescriptor = {
  node_type: "pdf",
  icon: "📄",
  color: "#e53935",
  shape: "rect",
  toolbar_label: "node.pdf.label",
  category: "integration",
  output_schema: [
    { name: "result", type: "string", description: "node.pdf.output.result" },
    { name: "success", type: "boolean", description: "node.pdf.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.pdf.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: PdfEditPanel,
};
