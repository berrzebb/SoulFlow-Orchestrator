import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

const STATS_OPS = ["summary", "percentile", "histogram", "correlation", "normalize", "outliers"];
const TIMESERIES_OPS = ["moving_average", "ema", "linear_forecast", "anomaly", "diff", "cumsum", "autocorrelation"];

function StatsEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "summary");
  return (
    <>
      <BuilderField label={t("workflows.operation")} required>
        <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
          <optgroup label={t("workflows.stats_group_statistics")}>{STATS_OPS.map((o) => <option key={o} value={o}>{t(`node.action.${o}`)}</option>)}</optgroup>
          <optgroup label={t("workflows.stats_group_timeseries")}>{TIMESERIES_OPS.map((o) => <option key={o} value={o}>{t(`node.action.${o}`)}</option>)}</optgroup>
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
      {(op === "outliers" || op === "anomaly") && (
        <BuilderField label={t("workflows.stats_threshold_zscore")}>
          <input className="input input--sm" type="number" min={1} max={10} step={0.5} value={String(node.threshold ?? 2)} onChange={(e) => update({ threshold: Number(e.target.value) || 2 })} />
        </BuilderField>
      )}
      {op === "moving_average" && (
        <BuilderField label={t("workflows.stats_window")} hint={t("workflows.stats_window_hint")}>
          <input className="input input--sm" type="number" min={2} max={100} value={String(node.window ?? 3)} onChange={(e) => update({ window: Number(e.target.value) || 3 })} />
        </BuilderField>
      )}
      {op === "ema" && (
        <BuilderField label={t("workflows.stats_alpha")} hint={t("workflows.stats_alpha_hint")}>
          <input className="input input--sm" type="number" min={0.01} max={1} step={0.01} value={String(node.alpha ?? 0.3)} onChange={(e) => update({ alpha: Number(e.target.value) || 0.3 })} />
        </BuilderField>
      )}
      {op === "linear_forecast" && (
        <BuilderField label={t("workflows.stats_periods")} hint={t("workflows.stats_periods_hint")}>
          <input className="input input--sm" type="number" min={1} max={100} value={String(node.periods ?? 5)} onChange={(e) => update({ periods: Number(e.target.value) || 5 })} />
        </BuilderField>
      )}
      {op === "autocorrelation" && (
        <BuilderField label={t("workflows.stats_lag")} hint={t("workflows.stats_lag_hint")}>
          <input className="input input--sm" type="number" min={1} max={50} value={String(node.lag ?? 1)} onChange={(e) => update({ lag: Number(e.target.value) || 1 })} />
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
  create_default: () => ({ operation: "summary", data: "", data2: "", percentile: 50, bins: 10, threshold: 2, window: 3, alpha: 0.3, periods: 5, lag: 1 }),
  EditPanel: StatsEditPanel,
};
