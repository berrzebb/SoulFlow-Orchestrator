import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function DbEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.db_operation") || "Operation"}</label>
          <select className="input input--sm" value={String(node.operation || "query")} onChange={(e) => update({ operation: e.target.value })}>
            <option value="query">Query</option>
            <option value="insert">Insert</option>
            <option value="update">Update</option>
            <option value="delete">Delete</option>
          </select>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.db_datasource") || "Datasource"}</label>
          <input className="input input--sm" value={String(node.datasource || "")} onChange={(e) => update({ datasource: e.target.value })} placeholder="main-db" />
        </div>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.db_query") || "Query"}</label>
        <textarea className="input code-textarea" rows={4} value={String(node.query || "")} onChange={(e) => update({ query: e.target.value })} spellCheck={false} placeholder="SELECT * FROM users WHERE id = {{memory.user_id}}" />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.db_params") || "Params"}</label>
        <textarea className="input code-textarea" rows={2} value={node.params ? JSON.stringify(node.params, null, 2) : ""} onChange={(e) => { try { update({ params: e.target.value ? JSON.parse(e.target.value) : undefined }); } catch { /* ignore */ } }} spellCheck={false} placeholder='{"user_id": 42}' />
      </div>
    </>
  );
}

export const db_descriptor: FrontendNodeDescriptor = {
  node_type: "db",
  icon: "⛁",
  color: "#e74c3c",
  shape: "rect",
  toolbar_label: "+ DB",
  output_schema: [
    { name: "rows",          type: "array",  description: "Query result rows" },
    { name: "affected_rows", type: "number", description: "Affected row count" },
  ],
  input_schema: [
    { name: "query",      type: "string", description: "SQL or query expression" },
    { name: "datasource", type: "string", description: "Datasource identifier" },
    { name: "params",     type: "object", description: "Query parameters" },
  ],
  create_default: () => ({ operation: "query", datasource: "", query: "" }),
  EditPanel: DbEditPanel,
};
