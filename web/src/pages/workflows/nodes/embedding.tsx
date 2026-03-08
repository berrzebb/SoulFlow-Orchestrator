import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function EmbeddingEditPanel({ node, update, t, options }: EditPanelProps) {
  const models = options?.models || [];
  return (
    <>
      <BuilderField label={t("workflows.embed_input")}>
        <input autoFocus className="input input--sm" value={String(node.input_field || "")} onChange={(e) => update({ input_field: e.target.value })} placeholder="memory.document_text" />
      </BuilderField>
      <BuilderField label={t("workflows.embed_model")}>
        {models.length > 0 ? (
          <select className="input input--sm" value={String(node.model || "")} onChange={(e) => update({ model: e.target.value })}>
            <option value="">{t("common.select")}</option>
            {models.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
          </select>
        ) : (
          <input className="input input--sm" value={String(node.model || "")} onChange={(e) => update({ model: e.target.value })} placeholder="text-embedding-3-small" />
        )}
      </BuilderField>
      <BuilderRowPair>
        <BuilderField label={t("workflows.embed_batch")} hint={t("workflows.embed_batch_hint")}>
          <input className="input input--sm" type="number" min={1} max={2048} value={String(node.batch_size ?? 32)} onChange={(e) => update({ batch_size: Number(e.target.value) || 32 })} />
        </BuilderField>
        <BuilderField label={t("workflows.embed_dims")} hint={t("workflows.embed_dims_hint")}>
          <input className="input input--sm" type="number" min={1} value={String(node.dimensions ?? "")} onChange={(e) => update({ dimensions: e.target.value ? Number(e.target.value) : undefined })} placeholder="auto" />
        </BuilderField>
      </BuilderRowPair>
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
