import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function TextSplitterEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.splitter_input") || "Input Field"}</label>
        <input className="input input--sm" value={String(node.input_field || "")} onChange={(e) => update({ input_field: e.target.value })} placeholder="memory.document_text" />
      </div>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.splitter_chunk_size") || "Chunk Size"}</label>
          <input className="input input--sm" type="number" min={50} value={String(node.chunk_size ?? 1000)} onChange={(e) => update({ chunk_size: Number(e.target.value) || 1000 })} />
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.splitter_overlap") || "Overlap"}</label>
          <input className="input input--sm" type="number" min={0} value={String(node.chunk_overlap ?? 200)} onChange={(e) => update({ chunk_overlap: Number(e.target.value) || 0 })} />
        </div>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.splitter_separator") || "Separator"}</label>
        <input className="input input--sm" value={String(node.separator ?? "\\n\\n")} onChange={(e) => update({ separator: e.target.value.replace(/\\n/g, "\n") })} placeholder="\n\n" />
      </div>
    </>
  );
}

export const text_splitter_descriptor: FrontendNodeDescriptor = {
  node_type: "text_splitter",
  icon: "✂",
  color: "#ff5722",
  shape: "rect",
  toolbar_label: "+ Split✂",
  output_schema: [
    { name: "chunks",      type: "array",  description: "Text chunks" },
    { name: "chunk_count", type: "number", description: "Number of chunks" },
  ],
  input_schema: [
    { name: "text",       type: "string", description: "Text to split" },
    { name: "chunk_size", type: "number", description: "Characters per chunk" },
    { name: "overlap",    type: "number", description: "Overlap between chunks" },
  ],
  create_default: () => ({ input_field: "text", chunk_size: 1000, chunk_overlap: 200, separator: "\n\n" }),
  EditPanel: TextSplitterEditPanel,
};
