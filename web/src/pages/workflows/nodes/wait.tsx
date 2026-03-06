import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function WaitEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.wait_type")}</label>
        <select className="input input--sm" value={String(node.wait_type || "timer")} onChange={(e) => update({ wait_type: e.target.value })}>
          <option value="timer">Timer</option>
          <option value="webhook">Webhook</option>
          <option value="approval">Approval</option>
        </select>
      </div>
      {String(node.wait_type || "timer") === "timer" && (
        <div className="builder-row">
          <label className="label">{t("workflows.wait_delay")}</label>
          <input className="input input--sm" type="number" min={0} value={String(node.delay_ms ?? 5000)} onChange={(e) => update({ delay_ms: Number(e.target.value) })} />
          <span className="builder-hint">{t("workflows.wait_delay_hint") || "Delay in milliseconds (5000 = 5s)"}</span>
        </div>
      )}
      {String(node.wait_type) === "webhook" && (
        <div className="builder-row">
          <label className="label">{t("workflows.wait_webhook")}</label>
          <input className="input input--sm" value={String(node.webhook_path || "")} onChange={(e) => update({ webhook_path: e.target.value })} placeholder="/hooks/my-webhook" />
        </div>
      )}
      {String(node.wait_type) === "approval" && (
        <div className="builder-row">
          <label className="label">{t("workflows.wait_approval")}</label>
          <textarea className="input" rows={2} value={String(node.approval_message || "")} onChange={(e) => update({ approval_message: e.target.value })} placeholder="Please approve this step" />
        </div>
      )}
    </>
  );
}

export const wait_descriptor: FrontendNodeDescriptor = {
  node_type: "wait",
  icon: "⏸",
  color: "#607d8b",
  shape: "rect",
  toolbar_label: "+ Wait",
  category: "flow",
  output_schema: [
    { name: "resumed_at", type: "string", description: "Resume timestamp" },
    { name: "payload",    type: "object", description: "Webhook/approval payload" },
  ],
  input_schema: [
    { name: "data", type: "object", description: "Data to pass through" },
  ],
  create_default: () => ({ wait_type: "timer", delay_ms: 5000 }),
  EditPanel: WaitEditPanel,
};
