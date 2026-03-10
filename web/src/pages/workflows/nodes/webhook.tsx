import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function WebhookEditPanel({ node, update, t }: EditPanelProps) {
  const response_mode = String(node.response_mode || "immediate");
  return (
    <>
      <BuilderField label={t("workflows.webhook_node_path")}>
        <input autoFocus className="input input--sm" value={String(node.path || "")} onChange={(e) => update({ path: e.target.value })} placeholder="/hooks/my-webhook" aria-label={t("workflows.webhook_node_path")} />
      </BuilderField>
      <BuilderRowPair>
        <BuilderField label={t("workflows.webhook_node_method")}>
          <select className="input input--sm" value={String(node.http_method || "POST")} onChange={(e) => update({ http_method: e.target.value })} aria-label={t("workflows.webhook_node_method")}>
            {["GET", "POST", "PUT", "DELETE"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.webhook_response_mode")}>
          <select className="input input--sm" value={response_mode} onChange={(e) => update({ response_mode: e.target.value })} aria-label={t("workflows.webhook_response_mode")}>
            <option value="immediate">{t("workflows.webhook_response_immediate")}</option>
            <option value="wait">{t("workflows.webhook_response_wait")}</option>
          </select>
        </BuilderField>
      </BuilderRowPair>
      {response_mode === "wait" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.webhook_response_status")} hint={t("workflows.webhook_status_hint")}>
            <input className="input input--sm" type="number" value={String(node.response_status ?? 200)} onChange={(e) => update({ response_status: Number(e.target.value) })} placeholder="200" aria-label={t("workflows.webhook_response_status")} />
          </BuilderField>
          <BuilderField label={t("workflows.webhook_response_body")}>
            <input className="input input--sm" value={String(node.response_body || "")} onChange={(e) => update({ response_body: e.target.value })} placeholder='{"ok": true}' aria-label={t("workflows.webhook_response_body")} />
          </BuilderField>
        </BuilderRowPair>
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
  create_default: () => ({ path: "", http_method: "POST", response_mode: "immediate", response_status: 200, response_body: "" }),
  EditPanel: WebhookEditPanel,
};
