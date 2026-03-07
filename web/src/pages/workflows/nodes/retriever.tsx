import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function RetrieverEditPanel({ node, update, t }: EditPanelProps) {
  const source = String(node.source || "http");
  return (
    <>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.retriever_source")}</label>
          <select className="input input--sm" value={source} onChange={(e) => update({ source: e.target.value })}>
            <option value="http">{t("workflows.opt_http_api")}</option>
            <option value="file">{t("workflows.opt_file")}</option>
            <option value="memory">{t("workflows.opt_memory")}</option>
          </select>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.retriever_top_k")}</label>
          <input className="input input--sm" type="number" min={1} max={100} value={String(node.top_k ?? 5)} onChange={(e) => update({ top_k: Number(e.target.value) || 5 })} />
        </div>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.retriever_query")}</label>
        <input className="input input--sm" value={String(node.query || "")} onChange={(e) => update({ query: e.target.value })} placeholder="{{memory.user_question}}" />
      </div>
      {source === "http" && (
        <>
          <div className="builder-row-pair">
            <div className="builder-row">
              <label className="label">{t("workflows.http_method")}</label>
              <select className="input input--sm" value={String(node.method || "GET")} onChange={(e) => update({ method: e.target.value })}>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
              </select>
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.http_url")}</label>
              <input className="input input--sm" value={String(node.url || "")} onChange={(e) => update({ url: e.target.value })} placeholder="https://api.example.com/search" />
            </div>
          </div>
        </>
      )}
      {source === "file" && (
        <div className="builder-row">
          <label className="label">{t("workflows.file_path")}</label>
          <input className="input input--sm" value={String(node.file_path || "")} onChange={(e) => update({ file_path: e.target.value })} placeholder="data/knowledge.json" />
        </div>
      )}
    </>
  );
}

export const retriever_descriptor: FrontendNodeDescriptor = {
  node_type: "retriever",
  icon: "⤓",
  color: "#00bcd4",
  shape: "rect",
  toolbar_label: "node.retriever.label",
  category: "ai",
  output_schema: [
    { name: "results", type: "array",  description: "node.retriever.output.results" },
    { name: "count",   type: "number", description: "node.retriever.output.count" },
    { name: "query",   type: "string", description: "node.retriever.output.query" },
  ],
  input_schema: [
    { name: "query",  type: "string", description: "node.retriever.input.query" },
    { name: "source", type: "string", description: "node.retriever.input.source" },
  ],
  create_default: () => ({ source: "http", query: "", url: "", top_k: 5 }),
  EditPanel: RetrieverEditPanel,
};
