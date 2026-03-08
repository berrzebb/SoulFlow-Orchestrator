import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

function WaitEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("workflows.wait_type")}>
        <select autoFocus className="input input--sm" value={String(node.wait_type || "timer")} onChange={(e) => update({ wait_type: e.target.value })}>
          <option value="timer">{t("workflows.opt_timer")}</option>
          <option value="webhook">{t("workflows.opt_webhook")}</option>
          <option value="approval">{t("workflows.opt_approval")}</option>
        </select>
      </BuilderField>
      {String(node.wait_type || "timer") === "timer" && (
        <BuilderField label={t("workflows.wait_delay")} hint={t("workflows.wait_delay_hint")}>
          <input className="input input--sm" type="number" min={0} value={String(node.delay_ms ?? 5000)} onChange={(e) => update({ delay_ms: Number(e.target.value) })} />
        </BuilderField>
      )}
      {String(node.wait_type) === "webhook" && (
        <BuilderField label={t("workflows.wait_webhook")}>
          <input className="input input--sm" value={String(node.webhook_path || "")} onChange={(e) => update({ webhook_path: e.target.value })} placeholder="/hooks/my-webhook" />
        </BuilderField>
      )}
      {String(node.wait_type) === "approval" && (
        <BuilderField label={t("workflows.wait_approval")}>
          <textarea className="input" rows={2} value={String(node.approval_message || "")} onChange={(e) => update({ approval_message: e.target.value })} placeholder="Please approve this step" />
        </BuilderField>
      )}
    </>
  );
}

export const wait_descriptor: FrontendNodeDescriptor = {
  node_type: "wait",
  icon: "⏸",
  color: "#607d8b",
  shape: "rect",
  toolbar_label: "node.wait.label",
  category: "flow",
  output_schema: [
    { name: "resumed_at", type: "string", description: "node.wait.output.resumed_at" },
    { name: "payload",    type: "object", description: "node.wait.output.payload" },
  ],
  input_schema: [
    { name: "data", type: "object", description: "node.wait.input.data" },
  ],
  create_default: () => ({ wait_type: "timer", delay_ms: 5000 }),
  EditPanel: WaitEditPanel,
};
