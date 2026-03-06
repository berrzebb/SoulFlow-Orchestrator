import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function WebSearchEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.search_query")}</label>
        <input className="input" value={String(node.query || "")} onChange={(e) => update({ query: e.target.value })} placeholder="{{memory.keyword}} site:example.com" />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.max_results")}</label>
        <input className="input input--sm" type="number" min={1} max={20} value={String(node.max_results ?? 5)} onChange={(e) => update({ max_results: Number(e.target.value) || 5 })} />
      </div>
    </>
  );
}

export const web_search_descriptor: FrontendNodeDescriptor = {
  node_type: "web_search",
  icon: "\u{1F50D}",
  color: "#4285f4",
  shape: "rect",
  toolbar_label: "+ Web Search",
  category: "integration",
  output_schema: [
    { name: "results", type: "array",  description: "Search results" },
    { name: "query",   type: "string", description: "Resolved query" },
    { name: "count",   type: "number", description: "Result count" },
  ],
  input_schema: [
    { name: "query",       type: "string", description: "Search query" },
    { name: "max_results", type: "number", description: "Max results" },
  ],
  create_default: () => ({ query: "", max_results: 5 }),
  EditPanel: WebSearchEditPanel,
};
