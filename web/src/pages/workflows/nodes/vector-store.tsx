import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair, JsonField } from "../builder-field";

function VectorStoreEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "query");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.vs_operation")} required>
          <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
            <option value="query">{t("workflows.opt_query")}</option>
            <option value="upsert">{t("workflows.opt_upsert")}</option>
            <option value="delete">{t("workflows.opt_delete")}</option>
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.vs_store")}>
          <input className="input input--sm" value={String(node.store_id || "")} onChange={(e) => update({ store_id: e.target.value })} placeholder="default" />
        </BuilderField>
      </BuilderRowPair>
      <BuilderField label={t("workflows.vs_collection")}>
        <input className="input input--sm" value={String(node.collection || "")} onChange={(e) => update({ collection: e.target.value })} placeholder="default" />
      </BuilderField>
      {op === "query" && (
        <>
          <BuilderRowPair>
            <BuilderField label={t("workflows.vs_query_field")}>
              <input className="input input--sm" value={String(node.query_vector_field || "")} onChange={(e) => update({ query_vector_field: e.target.value })} placeholder="memory.query_embedding" />
            </BuilderField>
            <BuilderField label={t("workflows.vs_top_k")} hint={t("workflows.vs_top_k_hint")}>
              <input className="input input--sm" type="number" min={1} max={100} value={String(node.top_k ?? 5)} onChange={(e) => update({ top_k: Number(e.target.value) || 5 })} />
            </BuilderField>
          </BuilderRowPair>
          <BuilderField label={t("workflows.vs_min_score")} hint={t("workflows.vs_min_score_hint")}>
            <input className="input input--sm" type="number" step="0.05" min={0} max={1} value={String(node.min_score ?? 0)} onChange={(e) => update({ min_score: Number(e.target.value) || 0 })} />
          </BuilderField>
        </>
      )}
      {op === "upsert" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.vs_vectors")}>
            <input className="input input--sm" value={String(node.vectors_field || "")} onChange={(e) => update({ vectors_field: e.target.value })} placeholder="memory.embeddings" />
          </BuilderField>
          <BuilderField label={t("workflows.vs_docs")}>
            <input className="input input--sm" value={String(node.documents_field || "")} onChange={(e) => update({ documents_field: e.target.value })} placeholder="memory.chunks" />
          </BuilderField>
        </BuilderRowPair>
      )}
      {op === "delete" && (
        <BuilderField label={t("workflows.vs_ids")}>
          <input className="input input--sm" value={String(node.ids_field || "")} onChange={(e) => update({ ids_field: e.target.value })} placeholder="memory.delete_ids" />
        </BuilderField>
      )}
      <JsonField label={t("workflows.vs_filter")} hint={t("workflows.vs_filter_hint")} value={node.filter} onUpdate={(v) => update({ filter: v })} rows={2} small placeholder='{"category": "docs"}' emptyValue={undefined} />
    </>
  );
}

export const vector_store_descriptor: FrontendNodeDescriptor = {
  node_type: "vector_store",
  icon: "🗄",
  color: "#00897b",
  shape: "rect",
  toolbar_label: "node.vector_store.label",
  category: "ai",
  output_schema: [
    { name: "action",  type: "string", description: "node.vector_store.output.action" },
    { name: "results", type: "array",  description: "node.vector_store.output.results" },
    { name: "count",   type: "number", description: "node.vector_store.output.count" },
    { name: "ids",     type: "array",  description: "node.vector_store.output.ids" },
  ],
  input_schema: [
    { name: "operation",  type: "string", description: "node.vector_store.input.operation" },
    { name: "store_id",   type: "string", description: "node.vector_store.input.store_id" },
    { name: "collection", type: "string", description: "node.vector_store.input.collection" },
    { name: "top_k",      type: "number", description: "node.vector_store.input.top_k" },
  ],
  create_default: () => ({ operation: "query", store_id: "", collection: "default", top_k: 5, min_score: 0 }),
  EditPanel: VectorStoreEditPanel,
};
