import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function HitlEditPanel({ node, update, t, options }: EditPanelProps) {
  const target = String(node.target || "origin");
  const channels = options?.channels || [];
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.hitl_prompt")}</label>
        <textarea className="input" rows={3} value={String(node.prompt || "")} onChange={(e) => update({ prompt: e.target.value })} placeholder={t("workflows.hitl_prompt_hint")} />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.hitl_target")}</label>
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
      <div className="builder-row">
        <label className="label">{t("workflows.hitl_timeout")}</label>
        <input className="input input--sm" type="number" min={0} value={String(node.timeout_ms ?? 300000)} onChange={(e) => update({ timeout_ms: Number(e.target.value) })} />
        <span className="builder-hint">{t("workflows.hitl_timeout_hint")}</span>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.hitl_fallback")}</label>
        <input className="input input--sm" value={String(node.fallback_value || "")} onChange={(e) => update({ fallback_value: e.target.value || undefined })} placeholder={t("workflows.hitl_fallback_hint")} />
      </div>
    </>
  );
}

export const hitl_descriptor: FrontendNodeDescriptor = {
  node_type: "hitl",
  icon: "🙋",
  color: "#e91e63",
  shape: "rect",
  toolbar_label: "node.hitl.label",
  category: "interaction",
  output_schema: [
    { name: "response",     type: "string",  description: "node.hitl.output.response" },
    { name: "responded_by", type: "object",  description: "node.hitl.output.responded_by" },
    { name: "responded_at", type: "string",  description: "node.hitl.output.responded_at" },
    { name: "timed_out",    type: "boolean", description: "node.hitl.output.timed_out" },
  ],
  input_schema: [
    { name: "prompt",  type: "string", description: "node.hitl.input.prompt" },
    { name: "context", type: "object", description: "node.hitl.input.context" },
  ],
  create_default: () => ({ prompt: "", target: "origin", timeout_ms: 300000 }),
  EditPanel: HitlEditPanel,
};
