import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function RetrieverEditPanel({ node, update, t }: EditPanelProps) {
  const source = String(node.source || "http");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.retriever_source")}>
          <select autoFocus className="input input--sm" value={source} onChange={(e) => update({ source: e.target.value })}>
            <option value="http">{t("workflows.opt_http_api")}</option>
            <option value="file">{t("workflows.opt_file")}</option>
            <option value="memory">{t("workflows.opt_memory")}</option>
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.retriever_top_k")} hint={t("workflows.retriever_top_k_hint")}>
          <input className="input input--sm" type="number" min={1} max={100} value={String(node.top_k ?? 5)} onChange={(e) => update({ top_k: Number(e.target.value) || 5 })} />
        </BuilderField>
      </BuilderRowPair>
      <BuilderField label={t("workflows.retriever_query")}>
        <input className="input input--sm" value={String(node.query || "")} onChange={(e) => update({ query: e.target.value })} placeholder="{{memory.user_question}}" />
      </BuilderField>
      {source === "http" && (
        <>
          <BuilderRowPair>
            <BuilderField label={t("workflows.http_method")}>
              <select className="input input--sm" value={String(node.method || "GET")} onChange={(e) => update({ method: e.target.value })}>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
              </select>
            </BuilderField>
            <BuilderField label={t("workflows.http_url")}>
              <input className="input input--sm" value={String(node.url || "")} onChange={(e) => update({ url: e.target.value })} placeholder="https://api.example.com/search" />
            </BuilderField>
          </BuilderRowPair>
        </>
      )}
      {source === "file" && (
        <BuilderField label={t("workflows.file_path")}>
          <input className="input input--sm" value={String(node.file_path || "")} onChange={(e) => update({ file_path: e.target.value })} placeholder="data/knowledge.json" />
        </BuilderField>
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
  create_default: () => ({ source: "http", query: "", url: "", top_k: 5, method: "GET", file_path: "" }),
  EditPanel: RetrieverEditPanel,
};
