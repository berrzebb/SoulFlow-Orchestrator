import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["parse", "generate", "count", "headers", "filter"];

function CsvEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "parse");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{t(`node.action.${a}`)}</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.csv_delimiter")}>
          <input className="input input--sm" value={String(node.delimiter || ",")} onChange={(e) => update({ delimiter: e.target.value })} placeholder="," style={{ maxWidth: "80px" }} />
        </BuilderField>
      </BuilderRowPair>
      <div className="builder-row">
        <label className="label-inline">
          <input type="checkbox" checked={Boolean(node.has_header ?? true)} onChange={(e) => update({ has_header: e.target.checked })} />
          {t("workflows.csv_has_header")}
        </label>
      </div>
      <BuilderField label={t("workflows.field_input")} required>
        <textarea className="input" required rows={4} value={String(node.data || "")} onChange={(e) => update({ data: e.target.value })} placeholder="col1,col2" aria-required="true" />
      </BuilderField>
      {action === "generate" && (
        <BuilderField label={t("workflows.csv_columns")}>
          <input className="input input--sm" value={String(node.columns || "")} onChange={(e) => update({ columns: e.target.value })} placeholder="name,age,email" />
        </BuilderField>
      )}
      {action === "filter" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.csv_filter_column")} required>
            <input className="input input--sm" required value={String(node.filter_col || "")} onChange={(e) => update({ filter_col: e.target.value })} placeholder="column name" aria-required="true" />
          </BuilderField>
          <BuilderField label={t("workflows.csv_filter_value")} required>
            <input className="input input--sm" required value={String(node.filter_val || "")} onChange={(e) => update({ filter_val: e.target.value })} placeholder="value" aria-required="true" />
          </BuilderField>
        </BuilderRowPair>
      )}
    </>
  );
}

export const csv_descriptor: FrontendNodeDescriptor = {
  node_type: "csv",
  icon: "📊",
  color: "#4caf50",
  shape: "rect",
  toolbar_label: "node.csv.label",
  category: "data",
  output_schema: [
    { name: "result", type: "object", description: "node.csv.output.result" },
    { name: "success", type: "boolean", description: "node.csv.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.csv.input.action" },
    { name: "data",   type: "string", description: "node.csv.input.data" },
  ],
  create_default: () => ({ action: "parse", data: "", delimiter: ",", has_header: true, columns: "", filter_col: "", filter_val: "" }),
  EditPanel: CsvEditPanel,
};
