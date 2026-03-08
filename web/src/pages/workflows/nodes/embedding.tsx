import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function EmbeddingEditPanel({ node, update, t, options }: EditPanelProps) {
  const models = options?.models || [];
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.embed_input")}</label>
        <input autoFocus className="input input--sm" value={String(node.input_field || "")} onChange={(e) => update({ input_field: e.target.value })} placeholder="memory.document_text" />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.embed_model")}</label>
        {models.length > 0 ? (
          <select className="input input--sm" value={String(node.model || "")} onChange={(e) => update({ model: e.target.value })}>
            <option value="">{t("common.select")}</option>
            {models.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
          </select>
        ) : (
          <input className="input input--sm" value={String(node.model || "")} onChange={(e) => update({ model: e.target.value })} placeholder="text-embedding-3-small" />
        )}
      </div>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.embed_batch")}</label>
          <input className="input input--sm" type="number" min={1} max={2048} value={String(node.batch_size ?? 32)} onChange={(e) => update({ batch_size: Number(e.target.value) || 32 })} />
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.embed_dims")}</label>
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
  toolbar_label: "node.embedding.label",
  category: "ai",
  output_schema: [
    { name: "embeddings",  type: "array",  description: "node.embedding.output.embeddings" },
    { name: "model",       type: "string", description: "node.embedding.output.model" },
    { name: "dimensions",  type: "number", description: "node.embedding.output.dimensions" },
    { name: "count",       type: "number", description: "node.embedding.output.count" },
    { name: "token_usage", type: "number", description: "node.embedding.output.token_usage" },
  ],
  input_schema: [
    { name: "input_field", type: "string", description: "node.embedding.input.input_field" },
    { name: "model",       type: "string", description: "node.embedding.input.model" },
    { name: "batch_size",  type: "number", description: "node.embedding.input.batch_size" },
    { name: "dimensions",  type: "number", description: "node.embedding.input.dimensions" },
  ],
  create_default: () => ({ input_field: "text", model: "", batch_size: 32 }),
  EditPanel: EmbeddingEditPanel,
};
