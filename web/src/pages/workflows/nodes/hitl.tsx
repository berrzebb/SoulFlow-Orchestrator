import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function HitlEditPanel({ node, update, t, options }: EditPanelProps) {
  const target = String(node.target || "origin");
  const channels = options?.channels || [];
  return (
    <>
      <BuilderField label={t("workflows.hitl_prompt")}>
        <textarea autoFocus className="input" rows={3} value={String(node.prompt || "")} onChange={(e) => update({ prompt: e.target.value })} placeholder={t("workflows.hitl_prompt_hint")} />
      </BuilderField>
      <BuilderField label={t("workflows.hitl_target")}>
        <select className="input input--sm" value={target} onChange={(e) => update({ target: e.target.value })}>
          <option value="origin">{t("workflows.hitl_target_origin")}</option>
          <option value="specified">{t("workflows.hitl_target_specified")}</option>
        </select>
      </BuilderField>
      {target === "specified" && (
        <BuilderRowPair>
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
      <BuilderField label={t("workflows.hitl_timeout")} hint={t("workflows.hitl_timeout_hint")}>
        <input className="input input--sm" type="number" min={0} value={String(node.timeout_ms ?? 300000)} onChange={(e) => update({ timeout_ms: Number(e.target.value) })} />
      </BuilderField>
      <BuilderField label={t("workflows.hitl_fallback")}>
        <input className="input input--sm" value={String(node.fallback_value || "")} onChange={(e) => update({ fallback_value: e.target.value || undefined })} placeholder={t("workflows.hitl_fallback_hint")} />
      </BuilderField>
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
  create_default: () => ({ prompt: "", target: "origin", timeout_ms: 300000, channel: "", chat_id: "", fallback_value: "" }),
  EditPanel: HitlEditPanel,
};
