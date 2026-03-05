import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function VectorStoreEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "query");
  return (
    <>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.vs_operation") || "Operation"}</label>
          <select className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
            <option value="query">Query</option>
            <option value="upsert">Upsert</option>
            <option value="delete">Delete</option>
          </select>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.vs_store") || "Store ID"}</label>
          <input className="input input--sm" value={String(node.store_id || "")} onChange={(e) => update({ store_id: e.target.value })} placeholder="default" />
        </div>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.vs_collection") || "Collection"}</label>
        <input className="input input--sm" value={String(node.collection || "")} onChange={(e) => update({ collection: e.target.value })} placeholder="default" />
      </div>
      {op === "query" && (
        <>
          <div className="builder-row-pair">
            <div className="builder-row">
              <label className="label">{t("workflows.vs_query_field") || "Query Vector Field"}</label>
              <input className="input input--sm" value={String(node.query_vector_field || "")} onChange={(e) => update({ query_vector_field: e.target.value })} placeholder="memory.query_embedding" />
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.vs_top_k") || "Top K"}</label>
              <input className="input input--sm" type="number" min={1} max={100} value={String(node.top_k ?? 5)} onChange={(e) => update({ top_k: Number(e.target.value) || 5 })} />
            </div>
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.vs_min_score") || "Min Score"}</label>
            <input className="input input--sm" type="number" step="0.05" min={0} max={1} value={String(node.min_score ?? 0)} onChange={(e) => update({ min_score: Number(e.target.value) || 0 })} />
          </div>
        </>
      )}
      {op === "upsert" && (
        <div className="builder-row-pair">
          <div className="builder-row">
            <label className="label">{t("workflows.vs_vectors") || "Vectors Field"}</label>
            <input className="input input--sm" value={String(node.vectors_field || "")} onChange={(e) => update({ vectors_field: e.target.value })} placeholder="memory.embeddings" />
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.vs_docs") || "Documents Field"}</label>
            <input className="input input--sm" value={String(node.documents_field || "")} onChange={(e) => update({ documents_field: e.target.value })} placeholder="memory.chunks" />
          </div>
        </div>
      )}
      {op === "delete" && (
        <div className="builder-row">
          <label className="label">{t("workflows.vs_ids") || "IDs Field"}</label>
          <input className="input input--sm" value={String(node.ids_field || "")} onChange={(e) => update({ ids_field: e.target.value })} placeholder="memory.delete_ids" />
        </div>
      )}
    </>
  );
}

export const vector_store_descriptor: FrontendNodeDescriptor = {
  node_type: "vector_store",
  icon: "🗄",
  color: "#00897b",
  shape: "rect",
  toolbar_label: "+ VecStore",
  output_schema: [
    { name: "action",  type: "string", description: "Operation performed" },
    { name: "results", type: "array",  description: "Query results (with score)" },
    { name: "count",   type: "number", description: "Affected/returned count" },
    { name: "ids",     type: "array",  description: "Upserted/deleted IDs" },
  ],
  input_schema: [
    { name: "operation",  type: "string", description: "upsert | query | delete" },
    { name: "store_id",   type: "string", description: "Vector store ID" },
    { name: "collection", type: "string", description: "Collection name" },
    { name: "top_k",      type: "number", description: "Results to return" },
  ],
  create_default: () => ({ operation: "query", store_id: "", collection: "default", top_k: 5, min_score: 0 }),
  EditPanel: VectorStoreEditPanel,
};
