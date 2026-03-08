import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function NotifyEditPanel({ node, update, t, options }: EditPanelProps) {
  const target = String(node.target || "origin");
  const channels = options?.channels || [];
  return (
    <>
      <BuilderField label={t("workflows.notify_content")}>
        <textarea autoFocus className="input" rows={3} value={String(node.content || "")} onChange={(e) => update({ content: e.target.value })} placeholder={t("workflows.notify_content_hint")} />
      </BuilderField>
      <BuilderField label={t("workflows.notify_target")}>
        <select className="input input--sm" value={target} onChange={(e) => update({ target: e.target.value })}>
          <option value="origin">{t("workflows.notify_target_origin")}</option>
          <option value="specified">{t("workflows.notify_target_specified")}</option>
        </select>
      </BuilderField>
      {target === "specified" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.notify_channel")}>
            <select className="input input--sm" value={String(node.channel || "")} onChange={(e) => update({ channel: e.target.value })}>
              <option value="">{t("common.select")}</option>
              {channels.map((c) => <option key={c.channel_id} value={c.provider}>{c.label} ({c.provider})</option>)}
            </select>
          </BuilderField>
          <BuilderField label={t("workflows.notify_chat_id")}>
            <input className="input input--sm" value={String(node.chat_id || "")} onChange={(e) => update({ chat_id: e.target.value })} />
          </BuilderField>
        </BuilderRowPair>
      )}
      <BuilderField label={t("workflows.notify_parse_mode")}>
        <select className="input input--sm" value={String(node.parse_mode || "")} onChange={(e) => update({ parse_mode: e.target.value || undefined })}>
          <option value="">{t("workflows.notify_parse_auto")}</option>
          <option value="markdown">{t("workflows.opt_markdown")}</option>
          <option value="html">{t("workflows.opt_html")}</option>
        </select>
      </BuilderField>
    </>
  );
}

export const notify_descriptor: FrontendNodeDescriptor = {
  node_type: "notify",
  icon: "📢",
  color: "#4caf50",
  shape: "rect",
  toolbar_label: "node.notify.label",
  category: "integration",
  output_schema: [
    { name: "ok",         type: "boolean", description: "node.notify.output.ok" },
    { name: "message_id", type: "string",  description: "node.notify.output.message_id" },
  ],
  input_schema: [
    { name: "content", type: "string", description: "node.notify.input.content" },
    { name: "channel", type: "string", description: "node.notify.input.channel" },
    { name: "chat_id", type: "string", description: "node.notify.input.chat_id" },
  ],
  create_default: () => ({ content: "", target: "origin" }),
  EditPanel: NotifyEditPanel,
};
