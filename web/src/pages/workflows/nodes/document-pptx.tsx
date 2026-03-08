import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function DocumentPptxEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.document_pptx.input.content")}</label>
        <input className="input input--sm" value={String(node.content || "")} onChange={(e) => update({ content: e.target.value })} />
      </div>
      <div className="builder-row">
        <label className="label">{t("node.document_pptx.input.output")}</label>
        <input className="input input--sm" value={String(node.output || "")} onChange={(e) => update({ output: e.target.value })} />
      </div>
      <div className="builder-row">
        <label className="label">{t("node.document_pptx.input.slide_format")}</label>
        <input className="input input--sm" value={String(node.slide_format || "")} onChange={(e) => update({ slide_format: e.target.value })} />
      </div>
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
  create_default: () => ({ content: "", output: "", slide_format: "" }),
  EditPanel: DocumentPptxEditPanel,
};
