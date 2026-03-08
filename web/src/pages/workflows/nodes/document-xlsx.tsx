import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

function DocumentXlsxEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("node.document_xlsx.input.content")}>
        <input autoFocus className="input input--sm" value={String(node.content || "")} onChange={(e) => update({ content: e.target.value })} />
      </BuilderField>
      <BuilderField label={t("node.document_xlsx.input.output")}>
        <input className="input input--sm" value={String(node.output || "")} onChange={(e) => update({ output: e.target.value })} />
      </BuilderField>
      <BuilderField label={t("node.document_xlsx.input.delimiter")}>
        <input className="input input--sm" value={String(node.delimiter || "")} onChange={(e) => update({ delimiter: e.target.value })} />
      </BuilderField>
    </>
  );
}

export const document_xlsx_descriptor: FrontendNodeDescriptor = {
  node_type: "document_xlsx",
  icon: "📊",
  color: "#2e7d32",
  shape: "rect",
  toolbar_label: "node.document_xlsx.label",
  category: "data",
  output_schema: [
    { name: "output", type: "string", description: "node.document_xlsx.output.output" },
    { name: "size_bytes", type: "number", description: "node.document_xlsx.output.size_bytes" },
    { name: "success", type: "boolean", description: "node.document_xlsx.output.success" },
  ],
  input_schema: [
    { name: "content", type: "string", description: "node.document_xlsx.input.content" },
    { name: "output", type: "string", description: "node.document_xlsx.input.output" },
    { name: "delimiter", type: "string", description: "node.document_xlsx.input.delimiter" },
  ],
  create_default: () => ({ content: "", output: "", delimiter: "" }),
  EditPanel: DocumentXlsxEditPanel,
};
