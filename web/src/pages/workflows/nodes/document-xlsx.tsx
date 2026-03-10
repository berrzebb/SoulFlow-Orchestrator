import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function DocumentXlsxEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("workflows.field_content")} required>
        <textarea autoFocus className="input" required rows={5} value={String(node.content || "")} onChange={(e) => update({ content: e.target.value })} placeholder="col1,col2,col3&#10;val1,val2,val3" aria-required="true" />
      </BuilderField>
      <BuilderRowPair>
        <BuilderField label={t("workflows.field_output_path")} required>
          <input className="input input--sm" required value={String(node.output || "")} onChange={(e) => update({ output: e.target.value })} placeholder="/tmp/output.xlsx" aria-required="true" />
        </BuilderField>
        <BuilderField label={t("workflows.csv_delimiter")}>
          <input className="input input--sm" value={String(node.delimiter || ",")} onChange={(e) => update({ delimiter: e.target.value })} placeholder="," style={{ maxWidth: "80px" }} />
        </BuilderField>
      </BuilderRowPair>
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
  create_default: () => ({ content: "", output: "", delimiter: "," }),
  EditPanel: DocumentXlsxEditPanel,
};
