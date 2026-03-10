import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

const PROM_ACTIONS = ["format", "parse", "push", "query_format"] as const;

function PrometheusEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "format");
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" value={action} onChange={(e) => update({ action: e.target.value })}>
          {PROM_ACTIONS.map((a) => <option key={a} value={a}>{t(`node.action.${a}`)}</option>)}
        </select>
      </BuilderField>

      {(action === "format" || action === "push") && (
        <BuilderField label={t("workflows.prom_metrics")} required hint={t("workflows.prom_metrics_hint")}>
          <textarea className="input code-textarea" rows={4} value={String(node.metrics || "")} onChange={(e) => update({ metrics: e.target.value })} placeholder='[{"name":"requests_total","type":"counter","help":"Total","value":42,"labels":{"env":"prod"}}]' />
        </BuilderField>
      )}

      {action === "parse" && (
        <BuilderField label={t("workflows.prom_input")} required hint={t("workflows.prom_input_hint")}>
          <textarea className="input code-textarea" rows={4} value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder={"# HELP requests_total Total requests\n# TYPE requests_total counter\nrequests_total{env=\"prod\"} 42"} />
        </BuilderField>
      )}

      {action === "push" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.prom_pushgateway_url")} required>
            <input className="input input--sm" value={String(node.pushgateway_url || "")} onChange={(e) => update({ pushgateway_url: e.target.value })} placeholder="http://localhost:9091" />
          </BuilderField>
          <BuilderField label={t("workflows.prom_job")}>
            <input className="input input--sm" value={String(node.job || "soulflow")} onChange={(e) => update({ job: e.target.value })} placeholder="soulflow" />
          </BuilderField>
        </BuilderRowPair>
      )}

      {action === "query_format" && (
        <>
          <BuilderField label={t("workflows.prom_query")} required hint={t("workflows.prom_query_hint")}>
            <input className="input" value={String(node.query || "")} onChange={(e) => update({ query: e.target.value })} placeholder="rate(requests_total[5m])" />
          </BuilderField>
          <BuilderRowPair>
            <BuilderField label={t("workflows.prom_start")}>
              <input className="input input--sm" value={String(node.start || "")} onChange={(e) => update({ start: e.target.value })} placeholder="2024-01-01T00:00:00Z" />
            </BuilderField>
            <BuilderField label={t("workflows.prom_end")}>
              <input className="input input--sm" value={String(node.end || "")} onChange={(e) => update({ end: e.target.value })} placeholder="2024-01-02T00:00:00Z" />
            </BuilderField>
          </BuilderRowPair>
          <BuilderField label={t("workflows.prom_step")}>
            <input className="input input--sm" value={String(node.step || "15s")} onChange={(e) => update({ step: e.target.value })} placeholder="15s" />
          </BuilderField>
        </>
      )}
    </>
  );
}

export const prometheus_descriptor: FrontendNodeDescriptor = {
  node_type: "prometheus",
  icon: "\u{1F4CA}",
  color: "#e65100",
  shape: "rect",
  toolbar_label: "node.prometheus.label",
  category: "integration",
  output_schema: [
    { name: "result",  type: "unknown", description: "node.prometheus.output.result" },
    { name: "success", type: "boolean", description: "node.prometheus.output.success" },
  ],
  input_schema: [
    { name: "action",  type: "string", description: "node.prometheus.input.action" },
    { name: "metrics", type: "string", description: "node.prometheus.input.metrics" },
  ],
  create_default: () => ({
    action: "format",
    metrics: '[{"name":"requests_total","type":"counter","help":"Total requests","value":0,"labels":{"env":"prod"}}]',
    input: "", pushgateway_url: "", job: "soulflow",
    query: "up", start: "", end: "", step: "15s",
  }),
  EditPanel: PrometheusEditPanel,
};
