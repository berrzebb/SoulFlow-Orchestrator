import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

function TextSplitterEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("workflows.splitter_input")}>
        <input autoFocus className="input input--sm" value={String(node.input_field || "")} onChange={(e) => update({ input_field: e.target.value })} placeholder="memory.document_text" />
      </BuilderField>
      <div className="builder-row-pair">
        <BuilderField label={t("workflows.splitter_chunk_size")}>
          <input className="input input--sm" type="number" min={50} value={String(node.chunk_size ?? 1000)} onChange={(e) => update({ chunk_size: Number(e.target.value) || 1000 })} />
        </BuilderField>
        <BuilderField label={t("workflows.splitter_overlap")}>
          <input className="input input--sm" type="number" min={0} value={String(node.chunk_overlap ?? 200)} onChange={(e) => update({ chunk_overlap: Number(e.target.value) || 0 })} />
        </BuilderField>
      </div>
      <BuilderField label={t("workflows.splitter_separator")}>
        <input className="input input--sm" value={String(node.separator ?? "\\n\\n")} onChange={(e) => update({ separator: e.target.value.replace(/\\n/g, "\n") })} placeholder="\n\n" />
      </BuilderField>
    </>
  );
}

export const text_splitter_descriptor: FrontendNodeDescriptor = {
  node_type: "text_splitter",
  icon: "✂",
  color: "#ff5722",
  shape: "rect",
  toolbar_label: "node.text_splitter.label",
  category: "ai",
  output_schema: [
    { name: "chunks",      type: "array",  description: "node.text_splitter.output.chunks" },
    { name: "chunk_count", type: "number", description: "node.text_splitter.output.chunk_count" },
  ],
  input_schema: [
    { name: "text",       type: "string", description: "node.text_splitter.input.text" },
    { name: "chunk_size", type: "number", description: "node.text_splitter.input.chunk_size" },
    { name: "overlap",    type: "number", description: "node.text_splitter.input.overlap" },
  ],
  create_default: () => ({ input_field: "text", chunk_size: 1000, chunk_overlap: 200, separator: "\n\n" }),
  EditPanel: TextSplitterEditPanel,
};
