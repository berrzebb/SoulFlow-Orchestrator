import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function RetryEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.retry_target")}</label>
        <input className="input input--sm" value={String(node.target_node || "")} onChange={(e) => update({ target_node: e.target.value })} placeholder="node_id" />
        <span className="builder-hint">{t("workflows.retry_target_hint")}</span>
      </div>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.retry_max_attempts")}</label>
          <input className="input input--sm" type="number" min={1} max={10} value={String(node.max_attempts ?? 3)} onChange={(e) => update({ max_attempts: Number(e.target.value) })} />
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.retry_backoff")}</label>
          <select className="input input--sm" value={String(node.backoff || "exponential")} onChange={(e) => update({ backoff: e.target.value })}>
            <option value="exponential">Exponential</option>
            <option value="linear">Linear</option>
            <option value="fixed">Fixed</option>
          </select>
        </div>
      </div>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.retry_initial_delay")}</label>
          <input className="input input--sm" type="number" min={100} value={String(node.initial_delay_ms ?? 1000)} onChange={(e) => update({ initial_delay_ms: Number(e.target.value) })} />
          <span className="builder-hint">ms</span>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.retry_max_delay")}</label>
          <input className="input input--sm" type="number" min={1000} value={String(node.max_delay_ms ?? 30000)} onChange={(e) => update({ max_delay_ms: Number(e.target.value) })} />
          <span className="builder-hint">ms</span>
        </div>
      </div>
    </>
  );
}

export const retry_descriptor: FrontendNodeDescriptor = {
  node_type: "retry",
  icon: "🔄",
  color: "#ff5722",
  shape: "rect",
  toolbar_label: "+ Retry",
  category: "flow",
  output_schema: [
    { name: "result",     type: "unknown", description: "Final result (success or last attempt)" },
    { name: "attempts",   type: "number",  description: "Total attempts made" },
    { name: "succeeded",  type: "boolean", description: "Whether any attempt succeeded" },
    { name: "last_error", type: "string",  description: "Last error message" },
  ],
  input_schema: [
    { name: "target_output", type: "unknown", description: "Output from target node" },
    { name: "target_error",  type: "string",  description: "Error from target node" },
  ],
  create_default: () => ({ target_node: "", max_attempts: 3, backoff: "exponential", initial_delay_ms: 1000, max_delay_ms: 30000 }),
  EditPanel: RetryEditPanel,
};
