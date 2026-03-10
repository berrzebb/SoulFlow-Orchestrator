import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function ApprovalEditPanel({ node, update, t, options }: EditPanelProps) {
  const target = String(node.target || "origin");
  const channels = options?.channels || [];
  return (
    <>
      <BuilderField label={t("workflows.approval_message")} required>
        <textarea autoFocus required className="input" rows={3} value={String(node.message || "")} onChange={(e) => update({ message: e.target.value })} placeholder={t("workflows.approval_message_hint")} aria-required="true" />
      </BuilderField>
      <BuilderField label={t("workflows.approval_target")} required>
        <select required className="input input--sm" value={target} onChange={(e) => update({ target: e.target.value })} aria-required="true">
          <option value="origin">{t("workflows.hitl_target_origin")}</option>
          <option value="specified">{t("workflows.hitl_target_specified")}</option>
        </select>
      </BuilderField>
      {target === "specified" && (
        <BuilderRowPair className="builder-row--conditional">
          <BuilderField label={t("workflows.hitl_channel")}>
            <select className="input input--sm" value={String(node.channel || "")} onChange={(e) => update({ channel: e.target.value })}>
              <option value="">{t("common.select")}</option>
              {channels.map((c) => <option key={c.channel_id} value={c.provider}>{c.label} ({c.provider})</option>)}
            </select>
          </BuilderField>
          <BuilderField label={t("workflows.hitl_chat_id")}>
            <input className="input input--sm" value={String(node.chat_id || "")} onChange={(e) => update({ chat_id: e.target.value })} />
          </BuilderField>
        </BuilderRowPair>
      )}
      <BuilderRowPair>
        <BuilderField label={t("workflows.approval_quorum")} required hint={t("workflows.approval_quorum_hint")}>
          <input required className="input input--sm" type="number" min={1} value={String(node.quorum ?? 1)} onChange={(e) => update({ quorum: Number(e.target.value) })} placeholder="1" aria-required="true" />
        </BuilderField>
        <BuilderField label={t("workflows.hitl_timeout")} required hint={t("workflows.hitl_timeout_hint")}>
          <input required className="input input--sm" type="number" min={0} value={String(node.timeout_ms ?? 600000)} onChange={(e) => update({ timeout_ms: Number(e.target.value) })} placeholder="600000" aria-required="true" />
        </BuilderField>
      </BuilderRowPair>
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
  toolbar_label: "node.approval.label",
  category: "interaction",
  output_schema: [
    { name: "approved",    type: "boolean", description: "node.approval.output.approved" },
    { name: "comment",     type: "string",  description: "node.approval.output.comment" },
    { name: "approved_by", type: "object",  description: "node.approval.output.approved_by" },
    { name: "approved_at", type: "string",  description: "node.approval.output.approved_at" },
    { name: "votes",       type: "array",   description: "node.approval.output.votes" },
  ],
  input_schema: [
    { name: "message", type: "string", description: "node.approval.input.message" },
    { name: "context", type: "object", description: "node.approval.input.context" },
  ],
  create_default: () => ({ message: "", target: "origin", require_comment: false, quorum: 1, timeout_ms: 600000 }),
  EditPanel: ApprovalEditPanel,
};
