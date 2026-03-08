import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

function WebSearchEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("workflows.search_query")}>
        <input autoFocus className="input" value={String(node.query || "")} onChange={(e) => update({ query: e.target.value })} placeholder="{{memory.keyword}} site:example.com" />
      </BuilderField>
      <BuilderField label={t("workflows.max_results")}>
        <input className="input input--sm" type="number" min={1} max={20} value={String(node.max_results ?? 5)} onChange={(e) => update({ max_results: Number(e.target.value) || 5 })} />
      </BuilderField>
    </>
  );
}

export const web_search_descriptor: FrontendNodeDescriptor = {
  node_type: "web_search",
  icon: "\u{1F50D}",
  color: "#4285f4",
  shape: "rect",
  toolbar_label: "node.web_search.label",
  category: "integration",
  output_schema: [
    { name: "results", type: "array",  description: "node.web_search.output.results" },
    { name: "query",   type: "string", description: "node.web_search.output.query" },
    { name: "count",   type: "number", description: "node.web_search.output.count" },
  ],
  input_schema: [
    { name: "query",       type: "string", description: "node.web_search.input.query" },
    { name: "max_results", type: "number", description: "node.web_search.input.max_results" },
  ],
  create_default: () => ({ query: "", max_results: 5 }),
  EditPanel: WebSearchEditPanel,
};
