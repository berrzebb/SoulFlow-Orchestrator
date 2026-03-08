import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function TableEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "sort");
  return (
    <>
      <BuilderField label={t("workflows.operation")} required>
        <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
          {["sort", "filter", "group_by", "join", "pivot", "aggregate", "distinct", "slice", "pluck", "count_by"].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </BuilderField>
      <BuilderField label={t("workflows.input_data")}>
        <textarea className="input code-textarea" rows={3} value={String(node.data || "")} onChange={(e) => update({ data: e.target.value })} placeholder='[{"name":"a","val":1}]' />
      </BuilderField>
      {["sort", "group_by", "pivot", "aggregate", "distinct", "pluck", "count_by"].includes(op) && (
        <BuilderField label={t("workflows.field_field")}>
          <input className="input" value={String(node.field || "")} onChange={(e) => update({ field: e.target.value })} placeholder="name" />
        </BuilderField>
      )}
      {op === "sort" && (
        <BuilderField label={t("workflows.field_order")}>
          <select className="input input--sm" value={String(node.order || "asc")} onChange={(e) => update({ order: e.target.value })}>
            <option value="asc">asc</option>
            <option value="desc">desc</option>
          </select>
        </BuilderField>
      )}
      {op === "filter" && (
        <BuilderField label={t("workflows.field_condition")}>
          <input className="input" value={String(node.condition || "")} onChange={(e) => update({ condition: e.target.value })} placeholder="row.val > 10" />
        </BuilderField>
      )}
      {op === "join" && (
        <>
          <BuilderField label={t("workflows.field_data_2")}>
            <textarea className="input code-textarea" rows={2} value={String(node.data2 || "")} onChange={(e) => update({ data2: e.target.value })} />
          </BuilderField>
          <BuilderRowPair>
            <BuilderField label={t("workflows.field_join_field")}>
              <input className="input input--sm" value={String(node.join_field || "id")} onChange={(e) => update({ join_field: e.target.value })} />
            </BuilderField>
            <BuilderField label={t("workflows.field_join_type")}>
              <select className="input input--sm" value={String(node.join_type || "inner")} onChange={(e) => update({ join_type: e.target.value })}>
                {["inner", "left", "right", "full"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </BuilderField>
          </BuilderRowPair>
        </>
      )}
      {["pivot", "aggregate"].includes(op) && (
        <BuilderField label={t("workflows.field_agg")}>
          <select className="input input--sm" value={String(node.agg || "count")} onChange={(e) => update({ agg: e.target.value })}>
            {["sum", "avg", "min", "max", "count"].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
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
