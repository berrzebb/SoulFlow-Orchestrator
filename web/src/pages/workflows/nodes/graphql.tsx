import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["query", "introspect"];

function GraphqlEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "query");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.graphql_url")} required>
          <input className="input input--sm" required value={String(node.url || "")} onChange={(e) => update({ url: e.target.value })} placeholder="https://api.example.com/graphql" aria-required="true" />
        </BuilderField>
      </BuilderRowPair>
      {action === "query" && (
        <>
          <BuilderField label={t("workflows.graphql_query")} required>
            <textarea className="input input--sm" required rows={4} value={String(node.query || "")} onChange={(e) => update({ query: e.target.value })} placeholder="{ user(id: 1) { name email } }" aria-required="true" />
          </BuilderField>
          <BuilderField label={t("workflows.graphql_variables")}>
            <textarea className="input input--sm" rows={2} value={String(node.variables || "")} onChange={(e) => update({ variables: e.target.value })} placeholder='{"id": 1}' />
          </BuilderField>
          <BuilderRowPair>
            <BuilderField label={t("workflows.graphql_headers")}>
              <input className="input input--sm" value={String(node.headers || "")} onChange={(e) => update({ headers: e.target.value })} placeholder='{"Authorization": "Bearer ..."}' />
            </BuilderField>
            <BuilderField label={t("workflows.graphql_operation_name")}>
              <input className="input input--sm" value={String(node.operation_name || "")} onChange={(e) => update({ operation_name: e.target.value })} />
            </BuilderField>
          </BuilderRowPair>
        </>
      )}
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
  create_default: () => ({ action: "query", url: "", query: "", variables: "", headers: "", operation_name: "" }),
  EditPanel: GraphqlEditPanel,
};
