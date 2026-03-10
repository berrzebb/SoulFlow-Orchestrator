import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["select", "insert", "update", "delete", "create_table", "validate", "parameterize"];
const DIALECTS = ["sqlite", "postgres", "mysql"];

function SqlBuilderEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "select");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.sql_dialect")}>
          <select className="input input--sm" value={String(node.dialect || "sqlite")} onChange={(e) => update({ dialect: e.target.value })}>
            {DIALECTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </BuilderField>
      </BuilderRowPair>
      {action !== "validate" && action !== "parameterize" && (
        <BuilderField label={t("workflows.field_table")} required>
          <input className="input input--sm" required value={String(node.table || "")} onChange={(e) => update({ table: e.target.value })} placeholder="users" aria-required="true" />
        </BuilderField>
      )}
      {(action === "validate" || action === "parameterize") && (
        <BuilderField label={t("workflows.field_sql")} required>
          <textarea className="input input--sm" required rows={4} value={String(node.sql || "")} onChange={(e) => update({ sql: e.target.value })} placeholder="SELECT * FROM users WHERE id = ?" aria-required="true" />
        </BuilderField>
      )}
      {action === "select" && (
        <BuilderField label={t("workflows.sql_where")}>
          <input className="input input--sm" value={String(node.where || "")} onChange={(e) => update({ where: e.target.value })} placeholder="id = 1" />
        </BuilderField>
      )}
      {(action === "insert" || action === "update") && (
        <BuilderField label={t("workflows.sql_values_json")} required>
          <textarea className="input input--sm" required rows={3} value={String(node.values || "")} onChange={(e) => update({ values: e.target.value })} placeholder="{...}" aria-required="true" />
        </BuilderField>
      )}
    </>
  );
}

export const sql_builder_descriptor: FrontendNodeDescriptor = {
  node_type: "sql_builder",
  icon: "📊",
  color: "#336791",
  shape: "rect",
  toolbar_label: "node.sql_builder.label",
  category: "data",
  output_schema: [
    { name: "result", type: "string", description: "node.sql_builder.output.result" },
    { name: "success", type: "boolean", description: "node.sql_builder.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.sql_builder.input.action" },
    { name: "table", type: "string", description: "node.sql_builder.input.table" },
  ],
  create_default: () => ({ action: "select", table: "", dialect: "sqlite", where: "", values: "" }),
  EditPanel: SqlBuilderEditPanel,
};
