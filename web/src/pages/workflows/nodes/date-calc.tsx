import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

function DateCalcEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "now");
  return (
    <>
      <BuilderField label={t("workflows.operation")} required>
        <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
          {["now", "add", "diff", "timezone", "business_days", "format", "parse", "day_info", "range"].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </BuilderField>
      {op !== "now" && (
        <BuilderField label={t("workflows.field_date")}>
          <input className="input" value={String(node.date || "")} onChange={(e) => update({ date: e.target.value })} placeholder="2025-01-01T00:00:00Z" />
        </BuilderField>
      )}
      {["diff", "business_days", "range"].includes(op) && (
        <BuilderField label={t("workflows.field_date_2")}>
          <input className="input" value={String(node.date2 || "")} onChange={(e) => update({ date2: e.target.value })} placeholder="2025-12-31" />
        </BuilderField>
      )}
      {op === "add" && (
        <div className="builder-row-pair">
          <BuilderField label={t("workflows.field_amount")}>
            <input className="input input--sm" type="number" value={String(node.amount ?? 0)} onChange={(e) => update({ amount: Number(e.target.value) })} />
          </BuilderField>
          <BuilderField label={t("workflows.field_unit")}>
            <select className="input input--sm" value={String(node.unit || "d")} onChange={(e) => update({ unit: e.target.value })}>
              {["ms", "s", "min", "h", "d", "week", "month", "year"].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </BuilderField>
        </div>
      )}
      {op === "timezone" && (
        <div className="builder-row-pair">
          <BuilderField label={t("workflows.field_from_tz")}>
            <input className="input input--sm" value={String(node.from_tz || "UTC")} onChange={(e) => update({ from_tz: e.target.value })} />
          </BuilderField>
          <BuilderField label={t("workflows.field_to_tz")}>
            <input className="input input--sm" value={String(node.to_tz || "UTC")} onChange={(e) => update({ to_tz: e.target.value })} />
          </BuilderField>
        </div>
      )}
      {["format", "now"].includes(op) && (
        <BuilderField label={t("workflows.field_format")}>
          <input className="input" value={String(node.format || "")} onChange={(e) => update({ format: e.target.value })} placeholder="YYYY-MM-DD HH:mm:ss" />
        </BuilderField>
      )}
    </>
  );
}

export const date_calc_descriptor: FrontendNodeDescriptor = {
  node_type: "date_calc",
  icon: "\u{1F4C5}",
  color: "#e65100",
  shape: "rect",
  toolbar_label: "node.date_calc.label",
  category: "data",
  output_schema: [
    { name: "result",  type: "string",  description: "node.date_calc.output.result" },
    { name: "success", type: "boolean", description: "node.date_calc.output.success" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "node.date_calc.input.operation" },
    { name: "date",      type: "string", description: "node.date_calc.input.date" },
  ],
  create_default: () => ({ operation: "now", date: "", date2: "", amount: 0, unit: "d", from_tz: "UTC", to_tz: "UTC", format: "YYYY-MM-DD" }),
  EditPanel: DateCalcEditPanel,
};
