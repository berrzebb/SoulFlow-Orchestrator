import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function WebhookEditPanel({ node, update, t }: EditPanelProps) {
  const response_mode = String(node.response_mode || "immediate");
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.webhook_node_path")}</label>
        <input className="input input--sm" value={String(node.path || "")} onChange={(e) => update({ path: e.target.value })} placeholder="/hooks/my-webhook" />
      </div>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.webhook_node_method")}</label>
          <select className="input input--sm" value={String(node.http_method || "POST")} onChange={(e) => update({ http_method: e.target.value })}>
            {["GET", "POST", "PUT", "DELETE"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.webhook_response_mode")}</label>
          <select className="input input--sm" value={response_mode} onChange={(e) => update({ response_mode: e.target.value })}>
            <option value="immediate">{t("workflows.webhook_response_immediate")}</option>
            <option value="wait">{t("workflows.webhook_response_wait")}</option>
          </select>
        </div>
      </div>
      {response_mode === "wait" && (
        <div className="builder-row-pair">
          <div className="builder-row">
            <label className="label">{t("workflows.webhook_response_status")}</label>
            <input className="input input--sm" type="number" value={String(node.response_status ?? 200)} onChange={(e) => update({ response_status: Number(e.target.value) })} />
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.webhook_response_body")}</label>
            <input className="input input--sm" value={String(node.response_body || "")} onChange={(e) => update({ response_body: e.target.value })} placeholder='{"ok": true}' />
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
  toolbar_label: "+ Webhook",
  category: "integration",
  output_schema: [
    { name: "method",  type: "string", description: "HTTP method" },
    { name: "headers", type: "object", description: "Request headers" },
    { name: "body",    type: "object", description: "Request body" },
    { name: "query",   type: "object", description: "Query parameters" },
  ],
  input_schema: [],
  create_default: () => ({ path: "", http_method: "POST", response_mode: "immediate" }),
  EditPanel: WebhookEditPanel,
};
