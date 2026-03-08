import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function GraphqlEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.graphql.input.url")}</label>
        <input autoFocus className="input input--sm" value={String(node.url || "")} onChange={(e) => update({ url: e.target.value })} />
      </div>
      <div className="builder-row">
        <label className="label">{t("node.graphql.input.query")}</label>
        <input className="input input--sm" value={String(node.query || "")} onChange={(e) => update({ query: e.target.value })} />
      </div>
      <div className="builder-row">
        <label className="label">{t("node.graphql.input.variables")}</label>
        <input className="input input--sm" value={String(node.variables || "")} onChange={(e) => update({ variables: e.target.value })} />
      </div>
    </>
  );
}

export const graphql_descriptor: FrontendNodeDescriptor = {
  node_type: "graphql",
  icon: "◇",
  color: "#e535ab",
  shape: "rect",
  toolbar_label: "node.graphql.label",
  category: "integration",
  output_schema: [
    { name: "data", type: "string", description: "node.graphql.output.data" },
    { name: "status", type: "number", description: "node.graphql.output.status" },
    { name: "success", type: "boolean", description: "node.graphql.output.success" },
  ],
  input_schema: [
    { name: "url", type: "string", description: "node.graphql.input.url" },
    { name: "query", type: "string", description: "node.graphql.input.query" },
    { name: "variables", type: "string", description: "node.graphql.input.variables" },
  ],
  create_default: () => ({ url: "", query: "", variables: "" }),
  EditPanel: GraphqlEditPanel,
};
