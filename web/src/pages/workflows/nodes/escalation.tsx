import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function EscalationEditPanel({ node, update, t, options }: EditPanelProps) {
  const channels = options?.channels || [];
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.escalation_condition")}</label>
        <select className="input input--sm" value={String(node.condition || "always")} onChange={(e) => update({ condition: e.target.value })}>
          <option value="always">{t("workflows.escalation_condition_always")}</option>
          <option value="on_timeout">{t("workflows.escalation_condition_timeout")}</option>
          <option value="on_rejection">{t("workflows.escalation_condition_rejection")}</option>
          <option value="custom">{t("workflows.escalation_condition_custom")}</option>
        </select>
      </div>
      {String(node.condition) === "custom" && (
        <div className="builder-row">
          <label className="label">{t("workflows.escalation_expression")}</label>
          <input className="input input--sm" value={String(node.custom_expression || "")} onChange={(e) => update({ custom_expression: e.target.value })} placeholder="memory.status === 'failed'" />
        </div>
      )}
      <div className="builder-row">
        <label className="label">{t("workflows.escalation_message")}</label>
        <textarea className="input" rows={3} value={String(node.message || "")} onChange={(e) => update({ message: e.target.value })} placeholder={t("workflows.escalation_message_hint")} />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.escalation_priority")}</label>
        <select className="input input--sm" value={String(node.priority || "high")} onChange={(e) => update({ priority: e.target.value })}>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.escalation_target_channel")}</label>
          <select className="input input--sm" value={String(node.target_channel || "")} onChange={(e) => update({ target_channel: e.target.value })}>
            <option value="">{t("common.select")}</option>
            {channels.map((c) => <option key={c.channel_id} value={c.provider}>{c.label} ({c.provider})</option>)}
          </select>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.escalation_target_chat_id")}</label>
          <input className="input input--sm" value={String(node.target_chat_id || "")} onChange={(e) => update({ target_chat_id: e.target.value })} />
        </div>
      </div>
    </>
  );
}

export const escalation_descriptor: FrontendNodeDescriptor = {
  node_type: "escalation",
  icon: "🚨",
  color: "#f44336",
  shape: "rect",
  toolbar_label: "+ Escalation",
  category: "interaction",
  output_schema: [
    { name: "escalated",    type: "boolean", description: "Whether escalation was triggered" },
    { name: "escalated_to", type: "object",  description: "Escalation target info" },
    { name: "escalated_at", type: "string",  description: "Escalation timestamp" },
    { name: "reason",       type: "string",  description: "Escalation reason" },
  ],
  input_schema: [
    { name: "trigger_data", type: "object", description: "Data that triggered escalation" },
    { name: "context",      type: "object", description: "Additional context" },
  ],
  create_default: () => ({ condition: "always", message: "", target_channel: "", target_chat_id: "", priority: "high" }),
  EditPanel: EscalationEditPanel,
};
