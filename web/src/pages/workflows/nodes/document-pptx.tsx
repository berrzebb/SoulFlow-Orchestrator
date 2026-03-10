import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

const SLIDE_FORMATS = ["markdown", "json", "text"];

function DocumentPptxEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("workflows.document_pptx_slide_format")}>
        <select autoFocus className="input input--sm" value={String(node.slide_format || "markdown")} onChange={(e) => update({ slide_format: e.target.value })}>
          {SLIDE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </BuilderField>
      <BuilderField label={t("workflows.field_content")} required>
        <textarea className="input" required rows={6} value={String(node.content || "")} onChange={(e) => update({ content: e.target.value })} placeholder="# Slide 1&#10;Content&#10;---&#10;# Slide 2" aria-required="true" />
      </BuilderField>
      <BuilderField label={t("workflows.field_output_path")} required>
        <input className="input input--sm" required value={String(node.output || "")} onChange={(e) => update({ output: e.target.value })} placeholder="/tmp/output.pptx" aria-required="true" />
      </BuilderField>
    </>
  );
}

export const document_pptx_descriptor: FrontendNodeDescriptor = {
  node_type: "document_pptx",
  icon: "📋",
  color: "#e65100",
  shape: "rect",
  toolbar_label: "node.document_pptx.label",
  category: "data",
  output_schema: [
    { name: "output", type: "string", description: "node.document_pptx.output.output" },
    { name: "size_bytes", type: "number", description: "node.document_pptx.output.size_bytes" },
    { name: "success", type: "boolean", description: "node.document_pptx.output.success" },
  ],
  input_schema: [
    { name: "content", type: "string", description: "node.document_pptx.input.content" },
    { name: "output", type: "string", description: "node.document_pptx.input.output" },
    { name: "slide_format", type: "string", description: "node.document_pptx.input.slide_format" },
  ],
  create_default: () => ({ content: "", output: "", slide_format: "markdown" }),
  EditPanel: DocumentPptxEditPanel,
};
