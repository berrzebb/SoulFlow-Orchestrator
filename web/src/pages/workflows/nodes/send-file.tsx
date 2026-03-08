import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function SendFileEditPanel({ node, update, t, options }: EditPanelProps) {
  const target = String(node.target || "origin");
  const channels = options?.channels || [];
  return (
    <>
      <BuilderField label={t("workflows.send_file_path")}>
        <input autoFocus className="input input--sm" value={String(node.file_path || "")} onChange={(e) => update({ file_path: e.target.value })} placeholder="output/report.pdf" />
      </BuilderField>
      <BuilderField label={t("workflows.send_file_caption")}>
        <input className="input input--sm" value={String(node.caption || "")} onChange={(e) => update({ caption: e.target.value })} placeholder={t("workflows.send_file_caption_hint")} />
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
    </>
  );
}

export const send_file_descriptor: FrontendNodeDescriptor = {
  node_type: "send_file",
  icon: "📎",
  color: "#00bcd4",
  shape: "rect",
  toolbar_label: "node.send_file.label",
  category: "integration",
  output_schema: [
    { name: "ok",         type: "boolean", description: "node.send_file.output.ok" },
    { name: "message_id", type: "string",  description: "node.send_file.output.message_id" },
    { name: "file_name",  type: "string",  description: "node.send_file.output.file_name" },
  ],
  input_schema: [
    { name: "file_path", type: "string", description: "node.send_file.input.file_path" },
    { name: "channel",   type: "string", description: "node.send_file.input.channel" },
    { name: "chat_id",   type: "string", description: "node.send_file.input.chat_id" },
  ],
  create_default: () => ({ file_path: "", target: "origin" }),
  EditPanel: SendFileEditPanel,
};
