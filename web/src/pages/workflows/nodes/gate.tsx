import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function GateEditPanel({ node, update, t }: EditPanelProps) {
  const sources = Array.isArray(node.depends_on) ? (node.depends_on as string[]) : [];
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.gate_quorum")}</label>
        <input className="input input--sm" type="number" min={1} value={String(node.quorum ?? 1)} onChange={(e) => update({ quorum: Number(e.target.value) })} />
        <span className="builder-hint">{t("workflows.gate_quorum_hint")}{sources.length ? ` (${sources.length} sources)` : ""}</span>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.gate_on_timeout")}</label>
        <select className="input input--sm" value={String(node.on_timeout || "proceed")} onChange={(e) => update({ on_timeout: e.target.value })}>
          <option value="proceed">{t("workflows.gate_on_timeout_proceed")}</option>
          <option value="fail">{t("workflows.gate_on_timeout_fail")}</option>
        </select>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.hitl_timeout")}</label>
        <input className="input input--sm" type="number" min={0} value={String(node.timeout_ms ?? 300000)} onChange={(e) => update({ timeout_ms: Number(e.target.value) })} />
      </div>
    </>
  );
}

export const gate_descriptor: FrontendNodeDescriptor = {
  node_type: "gate",
  icon: "🚧",
  color: "#607d8b",
  shape: "diamond",
  toolbar_label: "+ Gate",
  category: "flow",
  output_schema: [
    { name: "completed",  type: "array",   description: "Completed source node IDs" },
    { name: "pending",    type: "array",   description: "Still-pending source node IDs" },
    { name: "results",    type: "object",  description: "Results from completed sources" },
    { name: "quorum_met", type: "boolean", description: "Whether quorum was met" },
  ],
  input_schema: [
    { name: "sources", type: "array", description: "Source node results" },
  ],
  create_default: () => ({ quorum: 1, timeout_ms: 300000, on_timeout: "proceed" }),
  EditPanel: GateEditPanel,
};
