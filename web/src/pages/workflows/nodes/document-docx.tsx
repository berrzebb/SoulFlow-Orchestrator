import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

const INPUT_FORMATS = ["markdown", "html", "text"];

function DocumentDocxEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("workflows.field_input_format")}>
        <select autoFocus className="input input--sm" value={String(node.input_format || "markdown")} onChange={(e) => update({ input_format: e.target.value })}>
          {INPUT_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </BuilderField>
      <BuilderField label={t("workflows.field_content")} required>
        <textarea className="input" required rows={6} value={String(node.content || "")} onChange={(e) => update({ content: e.target.value })} placeholder="# My Document&#10;&#10;Content here..." aria-required="true" />
      </BuilderField>
      <BuilderField label={t("workflows.field_output_path")} required>
        <input className="input input--sm" required value={String(node.output || "")} onChange={(e) => update({ output: e.target.value })} placeholder="/tmp/output.docx" aria-required="true" />
      </BuilderField>
    </>
  );
}

export const document_docx_descriptor: FrontendNodeDescriptor = {
  node_type: "document_docx",
  icon: "📝",
  color: "#1565c0",
  shape: "rect",
  toolbar_label: "node.document_docx.label",
  category: "data",
  output_schema: [
    { name: "output", type: "string", description: "node.document_docx.output.output" },
    { name: "size_bytes", type: "number", description: "node.document_docx.output.size_bytes" },
    { name: "success", type: "boolean", description: "node.document_docx.output.success" },
  ],
  input_schema: [
    { name: "content", type: "string", description: "node.document_docx.input.content" },
    { name: "input_format", type: "string", description: "node.document_docx.input.input_format" },
    { name: "output", type: "string", description: "node.document_docx.input.output" },
  ],
  create_default: () => ({ content: "", input_format: "markdown", output: "" }),
  EditPanel: DocumentDocxEditPanel,
};
