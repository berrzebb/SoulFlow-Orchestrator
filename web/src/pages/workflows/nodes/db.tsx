import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair, JsonField } from "../builder-field";

function DbEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.db_operation")} required>
          <select autoFocus className="input input--sm" value={String(node.operation || "query")} onChange={(e) => update({ operation: e.target.value })}>
            <option value="query">{t("workflows.opt_query")}</option>
            <option value="insert">{t("workflows.opt_insert")}</option>
            <option value="update">{t("workflows.opt_update")}</option>
            <option value="delete">{t("workflows.opt_delete")}</option>
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.db_datasource")}>
          <input className="input input--sm" value={String(node.datasource || "")} onChange={(e) => update({ datasource: e.target.value })} placeholder="main-db" />
        </BuilderField>
      </BuilderRowPair>
      <BuilderField label={t("workflows.db_query")} hint={t("workflows.db_query_hint")}>
        <textarea className="input code-textarea" rows={4} value={String(node.query || "")} onChange={(e) => update({ query: e.target.value })} spellCheck={false} placeholder="SELECT * FROM users WHERE id = {{memory.user_id}}" />
      </BuilderField>
      <JsonField label={t("workflows.db_params")} value={node.params} onUpdate={(v) => update({ params: v })} rows={2} placeholder='{"user_id": 42}' />
    </>
  );
}

export const db_descriptor: FrontendNodeDescriptor = {
  node_type: "db",
  icon: "⛁",
  color: "#e74c3c",
  shape: "rect",
  toolbar_label: "node.db.label",
  category: "data",
  output_schema: [
    { name: "rows",          type: "array",  description: "node.db.output.rows" },
    { name: "affected_rows", type: "number", description: "node.db.output.affected_rows" },
  ],
  input_schema: [
    { name: "query",      type: "string", description: "node.db.input.query" },
    { name: "datasource", type: "string", description: "node.db.input.datasource" },
    { name: "params",     type: "object", description: "node.db.input.params" },
  ],
  create_default: () => ({ operation: "query", datasource: "", query: "" }),
  EditPanel: DbEditPanel,
};
