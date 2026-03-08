import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function GateEditPanel({ node, update, t }: EditPanelProps) {
  const sources = Array.isArray(node.depends_on) ? (node.depends_on as string[]) : [];
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.gate_quorum")}</label>
        <input autoFocus className="input input--sm" type="number" min={1} value={String(node.quorum ?? 1)} onChange={(e) => update({ quorum: Number(e.target.value) })} aria-label={t("workflows.gate_quorum")} />
        <span className="builder-hint">{t("workflows.gate_quorum_hint")}{sources.length ? ` (${sources.length} sources)` : ""}</span>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.gate_on_timeout")}</label>
        <select className="input input--sm" value={String(node.on_timeout || "proceed")} onChange={(e) => update({ on_timeout: e.target.value })} aria-label={t("workflows.gate_on_timeout")}>
          <option value="proceed">{t("workflows.gate_on_timeout_proceed")}</option>
          <option value="fail">{t("workflows.gate_on_timeout_fail")}</option>
        </select>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.hitl_timeout")}</label>
        <input className="input input--sm" type="number" min={0} value={String(node.timeout_ms ?? 300000)} onChange={(e) => update({ timeout_ms: Number(e.target.value) })} aria-label={t("workflows.hitl_timeout")} />
        <span className="builder-hint">{t("workflows.hitl_timeout_hint")}</span>
      </div>
    </>
  );
}

export const gate_descriptor: FrontendNodeDescriptor = {
  node_type: "gate",
  icon: "🚧",
  color: "#607d8b",
  shape: "diamond",
  toolbar_label: "node.gate.label",
  category: "flow",
  output_schema: [
    { name: "completed",  type: "array",   description: "node.gate.output.completed" },
    { name: "pending",    type: "array",   description: "node.gate.output.pending" },
    { name: "results",    type: "object",  description: "node.gate.output.results" },
    { name: "quorum_met", type: "boolean", description: "node.gate.output.quorum_met" },
  ],
  input_schema: [
    { name: "sources", type: "array", description: "node.gate.input.sources" },
  ],
  create_default: () => ({ quorum: 1, timeout_ms: 300000, on_timeout: "proceed" }),
  EditPanel: GateEditPanel,
};
