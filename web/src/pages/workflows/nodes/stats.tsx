import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

function StatsEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "summary");
  return (
    <>
      <BuilderField label={t("workflows.operation")} required>
        <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
          {["summary", "percentile", "histogram", "correlation", "normalize", "outliers"].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </BuilderField>
      <BuilderField label={t("workflows.input_data")}>
        <textarea className="input code-textarea" rows={3} value={String(node.data || "")} onChange={(e) => update({ data: e.target.value })} placeholder="[1, 2, 3, 4, 5] or 1,2,3,4,5" />
      </BuilderField>
      {op === "correlation" && (
        <BuilderField label={t("workflows.field_data_2")}>
          <textarea className="input code-textarea" rows={2} value={String(node.data2 || "")} onChange={(e) => update({ data2: e.target.value })} placeholder="[10, 20, 30, 40, 50]" />
        </BuilderField>
      )}
      {op === "percentile" && (
        <BuilderField label={t("workflows.field_percentile")}>
          <input className="input input--sm" type="number" min={0} max={100} value={String(node.percentile ?? 50)} onChange={(e) => update({ percentile: Number(e.target.value) })} />
        </BuilderField>
      )}
      {op === "histogram" && (
        <BuilderField label={t("workflows.field_bins")}>
          <input className="input input--sm" type="number" min={2} max={100} value={String(node.bins ?? 10)} onChange={(e) => update({ bins: Number(e.target.value) })} />
        </BuilderField>
      )}
    </>
  );
}

export const stats_descriptor: FrontendNodeDescriptor = {
  node_type: "stats",
  icon: "\u{1F4CA}",
  color: "#283593",
  shape: "rect",
  toolbar_label: "node.stats.label",
  category: "data",
  output_schema: [
    { name: "result",  type: "string",  description: "node.stats.output.result" },
    { name: "success", type: "boolean", description: "node.stats.output.success" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "node.stats.input.operation" },
    { name: "data",      type: "string", description: "node.stats.input.data" },
  ],
  create_default: () => ({ operation: "summary", data: "", data2: "", percentile: 50, bins: 10, threshold: 2 }),
  EditPanel: StatsEditPanel,
};
