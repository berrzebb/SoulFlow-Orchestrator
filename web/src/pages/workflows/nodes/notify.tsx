import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function NotifyEditPanel({ node, update, t, options }: EditPanelProps) {
  const target = String(node.target || "origin");
  const channels = options?.channels || [];
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.notify_content")}</label>
        <textarea className="input" rows={3} value={String(node.content || "")} onChange={(e) => update({ content: e.target.value })} placeholder={t("workflows.notify_content_hint")} />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.notify_target")}</label>
        <select className="input input--sm" value={target} onChange={(e) => update({ target: e.target.value })}>
          <option value="origin">{t("workflows.notify_target_origin")}</option>
          <option value="specified">{t("workflows.notify_target_specified")}</option>
        </select>
      </div>
      {target === "specified" && (
        <div className="builder-row-pair">
          <div className="builder-row">
            <label className="label">{t("workflows.notify_channel")}</label>
            <select className="input input--sm" value={String(node.channel || "")} onChange={(e) => update({ channel: e.target.value })}>
              <option value="">{t("common.select")}</option>
              {channels.map((c) => <option key={c.channel_id} value={c.provider}>{c.label} ({c.provider})</option>)}
            </select>
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.notify_chat_id")}</label>
            <input className="input input--sm" value={String(node.chat_id || "")} onChange={(e) => update({ chat_id: e.target.value })} />
          </div>
        </div>
      )}
      <div className="builder-row">
        <label className="label">{t("workflows.notify_parse_mode")}</label>
        <select className="input input--sm" value={String(node.parse_mode || "")} onChange={(e) => update({ parse_mode: e.target.value || undefined })}>
          <option value="">{t("workflows.notify_parse_auto")}</option>
          <option value="markdown">Markdown</option>
          <option value="html">HTML</option>
        </select>
      </div>
    </>
  );
}

export const notify_descriptor: FrontendNodeDescriptor = {
  node_type: "notify",
  icon: "📢",
  color: "#4caf50",
  shape: "rect",
  toolbar_label: "+ Notify",
  category: "integration",
  output_schema: [
    { name: "ok",         type: "boolean", description: "Send success" },
    { name: "message_id", type: "string",  description: "Sent message ID" },
  ],
  input_schema: [
    { name: "content", type: "string", description: "Message content (override)" },
    { name: "channel", type: "string", description: "Target channel (override)" },
    { name: "chat_id", type: "string", description: "Target chat ID (override)" },
  ],
  create_default: () => ({ content: "", target: "origin" }),
  EditPanel: NotifyEditPanel,
};
