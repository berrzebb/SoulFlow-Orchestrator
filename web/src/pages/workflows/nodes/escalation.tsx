import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function EscalationEditPanel({ node, update, t, options }: EditPanelProps) {
  const channels = options?.channels || [];
  return (
    <>
      <BuilderField label={t("workflows.escalation_condition")}>
        <select autoFocus className="input input--sm" value={String(node.condition || "always")} onChange={(e) => update({ condition: e.target.value })}>
          <option value="always">{t("workflows.escalation_condition_always")}</option>
          <option value="on_timeout">{t("workflows.escalation_condition_timeout")}</option>
          <option value="on_rejection">{t("workflows.escalation_condition_rejection")}</option>
          <option value="custom">{t("workflows.escalation_condition_custom")}</option>
        </select>
      </BuilderField>
      {String(node.condition) === "custom" && (
        <BuilderField label={t("workflows.escalation_expression")}>
          <input className="input input--sm" value={String(node.custom_expression || "")} onChange={(e) => update({ custom_expression: e.target.value })} placeholder="memory.status === 'failed'" />
        </BuilderField>
      )}
      <BuilderField label={t("workflows.escalation_message")}>
        <textarea className="input" rows={3} value={String(node.message || "")} onChange={(e) => update({ message: e.target.value })} placeholder={t("workflows.escalation_message_hint")} />
      </BuilderField>
      <BuilderField label={t("workflows.escalation_priority")}>
        <select className="input input--sm" value={String(node.priority || "high")} onChange={(e) => update({ priority: e.target.value })}>
          <option value="critical">{t("workflows.opt_critical")}</option>
          <option value="high">{t("workflows.opt_high")}</option>
          <option value="medium">{t("workflows.opt_medium")}</option>
          <option value="low">{t("workflows.opt_low")}</option>
        </select>
      </BuilderField>
      <BuilderRowPair>
        <BuilderField label={t("workflows.escalation_target_channel")}>
          <select className="input input--sm" value={String(node.target_channel || "")} onChange={(e) => update({ target_channel: e.target.value })}>
            <option value="">{t("common.select")}</option>
            {channels.map((c) => <option key={c.channel_id} value={c.provider}>{c.label} ({c.provider})</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.escalation_target_chat_id")}>
          <input className="input input--sm" value={String(node.target_chat_id || "")} onChange={(e) => update({ target_chat_id: e.target.value })} />
        </BuilderField>
      </BuilderRowPair>
    </>
  );
}

export const escalation_descriptor: FrontendNodeDescriptor = {
  node_type: "escalation",
  icon: "🚨",
  color: "#f44336",
  shape: "rect",
  toolbar_label: "node.escalation.label",
  category: "interaction",
  output_schema: [
    { name: "escalated",    type: "boolean", description: "node.escalation.output.escalated" },
    { name: "escalated_to", type: "object",  description: "node.escalation.output.escalated_to" },
    { name: "escalated_at", type: "string",  description: "node.escalation.output.escalated_at" },
    { name: "reason",       type: "string",  description: "node.escalation.output.reason" },
  ],
  input_schema: [
    { name: "trigger_data", type: "object", description: "node.escalation.input.trigger_data" },
    { name: "context",      type: "object", description: "node.escalation.input.context" },
  ],
  create_default: () => ({ condition: "always", message: "", target_channel: "", target_chat_id: "", priority: "high" }),
  EditPanel: EscalationEditPanel,
};
