import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function TableEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "sort");
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.operation")}</label>
        <select className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
          {["sort", "filter", "group_by", "join", "pivot", "aggregate", "distinct", "slice", "pluck", "count_by"].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.input_data")}</label>
        <textarea className="input code-textarea" rows={3} value={String(node.data || "")} onChange={(e) => update({ data: e.target.value })} placeholder='[{"name":"a","val":1}]' />
      </div>
      {["sort", "group_by", "pivot", "aggregate", "distinct", "pluck", "count_by"].includes(op) && (
        <div className="builder-row">
          <label className="label">{t("workflows.field_field")}</label>
          <input className="input" value={String(node.field || "")} onChange={(e) => update({ field: e.target.value })} placeholder="name" />
        </div>
      )}
      {op === "sort" && (
        <div className="builder-row">
          <label className="label">{t("workflows.field_order")}</label>
          <select className="input input--sm" value={String(node.order || "asc")} onChange={(e) => update({ order: e.target.value })}>
            <option value="asc">asc</option>
            <option value="desc">desc</option>
          </select>
        </div>
      )}
      {op === "filter" && (
        <div className="builder-row">
          <label className="label">{t("workflows.field_condition")}</label>
          <input className="input" value={String(node.condition || "")} onChange={(e) => update({ condition: e.target.value })} placeholder="row.val > 10" />
        </div>
      )}
      {op === "join" && (
        <>
          <div className="builder-row">
            <label className="label">{t("workflows.field_data_2")}</label>
            <textarea className="input code-textarea" rows={2} value={String(node.data2 || "")} onChange={(e) => update({ data2: e.target.value })} />
          </div>
          <div className="builder-row-pair">
            <div className="builder-row">
              <label className="label">{t("workflows.field_join_field")}</label>
              <input className="input input--sm" value={String(node.join_field || "id")} onChange={(e) => update({ join_field: e.target.value })} />
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.field_join_type")}</label>
              <select className="input input--sm" value={String(node.join_type || "inner")} onChange={(e) => update({ join_type: e.target.value })}>
                {["inner", "left", "right", "full"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
        </>
      )}
      {["pivot", "aggregate"].includes(op) && (
        <div className="builder-row">
          <label className="label">{t("workflows.field_agg")}</label>
          <select className="input input--sm" value={String(node.agg || "count")} onChange={(e) => update({ agg: e.target.value })}>
            {["sum", "avg", "min", "max", "count"].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      )}
    </>
  );
}

export const table_descriptor: FrontendNodeDescriptor = {
  node_type: "table",
  icon: "\u{1F4CB}",
  color: "#00695c",
  shape: "rect",
  toolbar_label: "node.table.label",
  category: "data",
  output_schema: [
    { name: "result",  type: "string",  description: "node.table.output.result" },
    { name: "success", type: "boolean", description: "node.table.output.success" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "node.table.input.operation" },
    { name: "data",      type: "string", description: "node.table.input.data" },
  ],
  create_default: () => ({ operation: "sort", data: "", data2: "", field: "", condition: "", join_field: "id", join_type: "inner", agg: "count" }),
  EditPanel: TableEditPanel,
};
