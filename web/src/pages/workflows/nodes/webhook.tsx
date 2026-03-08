import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function WebhookEditPanel({ node, update, t }: EditPanelProps) {
  const response_mode = String(node.response_mode || "immediate");
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.webhook_node_path")}</label>
        <input autoFocus className="input input--sm" value={String(node.path || "")} onChange={(e) => update({ path: e.target.value })} placeholder="/hooks/my-webhook" aria-label={t("workflows.webhook_node_path")} />
      </div>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.webhook_node_method")}</label>
          <select className="input input--sm" value={String(node.http_method || "POST")} onChange={(e) => update({ http_method: e.target.value })} aria-label={t("workflows.webhook_node_method")}>
            {["GET", "POST", "PUT", "DELETE"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.webhook_response_mode")}</label>
          <select className="input input--sm" value={response_mode} onChange={(e) => update({ response_mode: e.target.value })} aria-label={t("workflows.webhook_response_mode")}>
            <option value="immediate">{t("workflows.webhook_response_immediate")}</option>
            <option value="wait">{t("workflows.webhook_response_wait")}</option>
          </select>
        </div>
      </div>
      {response_mode === "wait" && (
        <div className="builder-row-pair">
          <div className="builder-row">
            <label className="label">{t("workflows.webhook_response_status")}</label>
            <input className="input input--sm" type="number" value={String(node.response_status ?? 200)} onChange={(e) => update({ response_status: Number(e.target.value) })} placeholder="200" aria-label={t("workflows.webhook_response_status")} />
            <span className="builder-hint">{t("workflows.webhook_status_hint")}</span>
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.webhook_response_body")}</label>
            <input className="input input--sm" value={String(node.response_body || "")} onChange={(e) => update({ response_body: e.target.value })} placeholder='{"ok": true}' aria-label={t("workflows.webhook_response_body")} />
          </div>
        </div>
      )}
    </>
  );
}

export const webhook_descriptor: FrontendNodeDescriptor = {
  node_type: "webhook",
  icon: "🪝",
  color: "#ff9800",
  shape: "rect",
  toolbar_label: "node.webhook.label",
  category: "integration",
  output_schema: [
    { name: "method",  type: "string", description: "node.webhook.output.method" },
    { name: "headers", type: "object", description: "node.webhook.output.headers" },
    { name: "body",    type: "object", description: "node.webhook.output.body" },
    { name: "query",   type: "object", description: "node.webhook.output.query" },
  ],
  input_schema: [],
  create_default: () => ({ path: "", http_method: "POST", response_mode: "immediate" }),
  EditPanel: WebhookEditPanel,
};
