import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const OPERATIONS = [
  { value: "collect", label: "Collect (passthrough)" },
  { value: "count",   label: "Count" },
  { value: "sum",     label: "Sum" },
  { value: "avg",     label: "Average" },
  { value: "min",     label: "Min" },
  { value: "max",     label: "Max" },
  { value: "join",    label: "Join (string)" },
  { value: "unique",  label: "Unique" },
  { value: "flatten", label: "Flatten" },
];

function AggregateEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "collect");
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.aggregate_operation")}</label>
        <select className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
          {OPERATIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.aggregate_array_field")}</label>
        <input className="input input--sm" value={String(node.array_field || "")} onChange={(e) => update({ array_field: e.target.value })} placeholder="body.items" />
      </div>
      {op === "join" && (
        <div className="builder-row">
          <label className="label">{t("workflows.aggregate_separator")}</label>
          <input className="input input--sm" value={String(node.separator ?? "\\n")} onChange={(e) => update({ separator: e.target.value })} placeholder="\n" />
        </div>
      )}
    </>
  );
}

export const aggregate_descriptor: FrontendNodeDescriptor = {
  node_type: "aggregate",
  icon: "∑",
  color: "#9c27b0",
  shape: "rect",
  toolbar_label: "node.aggregate.label",
  category: "data",
  output_schema: [
    { name: "result", type: "unknown", description: "node.aggregate.output.result" },
    { name: "count",  type: "number",  description: "node.aggregate.output.count" },
  ],
  input_schema: [
    { name: "items", type: "array", description: "node.aggregate.input.items" },
  ],
  create_default: () => ({ operation: "collect", array_field: "" }),
  EditPanel: AggregateEditPanel,
};
