import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function ApprovalEditPanel({ node, update, t, options }: EditPanelProps) {
  const target = String(node.target || "origin");
  const channels = options?.channels || [];
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.approval_message")}</label>
        <textarea className="input" rows={3} value={String(node.message || "")} onChange={(e) => update({ message: e.target.value })} placeholder={t("workflows.approval_message_hint")} />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.approval_target")}</label>
        <select className="input input--sm" value={target} onChange={(e) => update({ target: e.target.value })}>
          <option value="origin">{t("workflows.hitl_target_origin")}</option>
          <option value="specified">{t("workflows.hitl_target_specified")}</option>
        </select>
      </div>
      {target === "specified" && (
        <div className="builder-row-pair">
          <div className="builder-row">
            <label className="label">{t("workflows.hitl_channel")}</label>
            <select className="input input--sm" value={String(node.channel || "")} onChange={(e) => update({ channel: e.target.value })}>
              <option value="">{t("common.select")}</option>
              {channels.map((c) => <option key={c.channel_id} value={c.provider}>{c.label} ({c.provider})</option>)}
            </select>
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.hitl_chat_id")}</label>
            <input className="input input--sm" value={String(node.chat_id || "")} onChange={(e) => update({ chat_id: e.target.value })} />
          </div>
        </div>
      )}
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.approval_quorum")}</label>
          <input className="input input--sm" type="number" min={1} value={String(node.quorum ?? 1)} onChange={(e) => update({ quorum: Number(e.target.value) })} />
          <span className="builder-hint">{t("workflows.approval_quorum_hint")}</span>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.hitl_timeout")}</label>
          <input className="input input--sm" type="number" min={0} value={String(node.timeout_ms ?? 600000)} onChange={(e) => update({ timeout_ms: Number(e.target.value) })} />
        </div>
      </div>
      <div className="builder-row">
        <label className="label-inline">
          <input type="checkbox" checked={!!node.require_comment} onChange={(e) => update({ require_comment: e.target.checked })} />
          {t("workflows.approval_require_comment")}
        </label>
      </div>
    </>
  );
}

export const approval_descriptor: FrontendNodeDescriptor = {
  node_type: "approval",
  icon: "✅",
  color: "#4caf50",
  shape: "rect",
  toolbar_label: "+ Approval",
  category: "interaction",
  output_schema: [
    { name: "approved",    type: "boolean", description: "Whether approved" },
    { name: "comment",     type: "string",  description: "Approver comment" },
    { name: "approved_by", type: "object",  description: "Approver info" },
    { name: "approved_at", type: "string",  description: "Decision timestamp" },
    { name: "votes",       type: "array",   description: "All votes (multi-approver)" },
  ],
  input_schema: [
    { name: "message", type: "string", description: "Approval message (override)" },
    { name: "context", type: "object", description: "Additional context data" },
  ],
  create_default: () => ({ message: "", target: "origin", require_comment: false, quorum: 1, timeout_ms: 600000 }),
  EditPanel: ApprovalEditPanel,
};
