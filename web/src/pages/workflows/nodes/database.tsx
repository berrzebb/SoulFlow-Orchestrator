import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function DatabaseEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "query");
  return (
    <>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.operation")}<span className="label__required">*</span></label>
          <select autoFocus className="input input--sm" required value={op} onChange={(e) => update({ operation: e.target.value })} aria-label={t("workflows.operation")} aria-required="true">
            {["query", "tables", "schema", "explain"].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.field_datasource")}<span className="label__required">*</span></label>
          <input className="input input--sm" required value={String(node.datasource || "")} onChange={(e) => update({ datasource: e.target.value })} placeholder="my_database" aria-label={t("workflows.field_datasource")} aria-required="true" />
        </div>
      </div>
      {(op === "query" || op === "explain") && (
        <div className="builder-row">
          <label className="label">{t("workflows.field_sql")}<span className="label__required">*</span></label>
          <textarea className="input code-textarea" required rows={4} value={String(node.sql || "")} onChange={(e) => update({ sql: e.target.value })} placeholder="SELECT * FROM users LIMIT 10" aria-label={t("workflows.field_sql")} aria-required="true" />
        </div>
      )}
      {op === "schema" && (
        <div className="builder-row">
          <label className="label">{t("workflows.field_table")}</label>
          <input className="input input--sm" value={String(node.table || "")} onChange={(e) => update({ table: e.target.value })} placeholder="users" aria-label={t("workflows.field_table")} />
        </div>
      )}
      {op === "query" && (
        <div className="builder-row">
          <label className="label">{t("workflows.max_results")}</label>
          <input className="input input--sm" type="number" min={1} max={1000} value={String(node.max_rows ?? 100)} onChange={(e) => update({ max_rows: Number(e.target.value) || 100 })} placeholder="100" aria-label={t("workflows.max_results")} />
          <span className="builder-hint">{t("workflows.max_results_hint", { min: "1", max: "1000" })}</span>
        </div>
      )}
    </>
  );
}

export const database_descriptor: FrontendNodeDescriptor = {
  node_type: "database",
  icon: "\u{1F5C4}",
  color: "#1565c0",
  shape: "rect",
  toolbar_label: "node.database.label",
  category: "integration",
  output_schema: [
    { name: "result",  type: "string",  description: "node.database.output.result" },
    { name: "success", type: "boolean", description: "node.database.output.success" },
  ],
  input_schema: [
    { name: "operation",  type: "string", description: "node.database.input.operation" },
    { name: "datasource", type: "string", description: "node.database.input.datasource" },
    { name: "sql",        type: "string", description: "node.database.input.sql" },
  ],
  create_default: () => ({ operation: "query", datasource: "", sql: "", table: "", max_rows: 100 }),
  EditPanel: DatabaseEditPanel,
};
