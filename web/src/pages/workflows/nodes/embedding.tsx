import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function EmbeddingEditPanel({ node, update, t, options }: EditPanelProps) {
  const models = options?.models || [];
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.embed_input") || "Input Field"}</label>
        <input className="input input--sm" value={String(node.input_field || "")} onChange={(e) => update({ input_field: e.target.value })} placeholder="memory.document_text" />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.embed_model") || "Embedding Model"}</label>
        {models.length > 0 ? (
          <select className="input input--sm" value={String(node.model || "")} onChange={(e) => update({ model: e.target.value })}>
            <option value="">{t("common.select") || "— Select —"}</option>
            {models.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
          </select>
        ) : (
          <input className="input input--sm" value={String(node.model || "")} onChange={(e) => update({ model: e.target.value })} placeholder="text-embedding-3-small" />
        )}
      </div>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.embed_batch") || "Batch Size"}</label>
          <input className="input input--sm" type="number" min={1} max={2048} value={String(node.batch_size ?? 32)} onChange={(e) => update({ batch_size: Number(e.target.value) || 32 })} />
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.embed_dims") || "Dimensions"}</label>
          <input className="input input--sm" type="number" min={1} value={String(node.dimensions ?? "")} onChange={(e) => update({ dimensions: e.target.value ? Number(e.target.value) : undefined })} placeholder="auto" />
        </div>
      </div>
    </>
  );
}

export const embedding_descriptor: FrontendNodeDescriptor = {
  node_type: "embedding",
  icon: "🧮",
  color: "#7c4dff",
  shape: "rect",
  toolbar_label: "+ Embed",
  category: "ai",
  output_schema: [
    { name: "embeddings",  type: "array",  description: "Generated embedding vectors" },
    { name: "model",       type: "string", description: "Model used" },
    { name: "dimensions",  type: "number", description: "Vector dimensions" },
    { name: "count",       type: "number", description: "Number of embeddings" },
    { name: "token_usage", type: "number", description: "Total tokens used" },
  ],
  input_schema: [
    { name: "input_field", type: "string", description: "Text field to embed" },
    { name: "model",       type: "string", description: "Embedding model ID" },
    { name: "batch_size",  type: "number", description: "Texts per batch" },
    { name: "dimensions",  type: "number", description: "Output dimensions" },
  ],
  create_default: () => ({ input_field: "text", model: "", batch_size: 32 }),
  EditPanel: EmbeddingEditPanel,
};
