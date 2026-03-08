import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

function DocumentPdfEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("node.document_pdf.input.content")}>
        <input autoFocus className="input input--sm" value={String(node.content || "")} onChange={(e) => update({ content: e.target.value })} />
      </BuilderField>
      <BuilderField label={t("node.document_pdf.input.input_format")}>
        <input className="input input--sm" value={String(node.input_format || "")} onChange={(e) => update({ input_format: e.target.value })} />
      </BuilderField>
      <BuilderField label={t("node.document_pdf.input.output")}>
        <input className="input input--sm" value={String(node.output || "")} onChange={(e) => update({ output: e.target.value })} />
      </BuilderField>
    </>
  );
}

export const document_pdf_descriptor: FrontendNodeDescriptor = {
  node_type: "document_pdf",
  icon: "📄",
  color: "#e53935",
  shape: "rect",
  toolbar_label: "node.document_pdf.label",
  category: "data",
  output_schema: [
    { name: "output", type: "string", description: "node.document_pdf.output.output" },
    { name: "size_bytes", type: "number", description: "node.document_pdf.output.size_bytes" },
    { name: "success", type: "boolean", description: "node.document_pdf.output.success" },
  ],
  input_schema: [
    { name: "content", type: "string", description: "node.document_pdf.input.content" },
    { name: "input_format", type: "string", description: "node.document_pdf.input.input_format" },
    { name: "output", type: "string", description: "node.document_pdf.input.output" },
  ],
  create_default: () => ({ content: "", input_format: "", output: "" }),
  EditPanel: DocumentPdfEditPanel,
};
