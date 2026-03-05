import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function OauthEditPanel({ node, update, t, options }: EditPanelProps) {
  const integrations = options?.oauth_integrations || [];
  const current = String(node.service_id || "");
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.oauth_service")}</label>
        {integrations.length > 0 ? (
          <select className="input input--sm" value={current} onChange={(e) => update({ service_id: e.target.value })}>
            <option value="">{t("common.select") || "— Select —"}</option>
            {integrations.map((i) => (
              <option key={i.instance_id} value={i.instance_id}>
                {i.label || i.instance_id} ({i.service_type})
              </option>
            ))}
          </select>
        ) : (
          <input className="input input--sm" value={current} onChange={(e) => update({ service_id: e.target.value })} placeholder="github" />
        )}
      </div>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.http_method")}</label>
          <select className="input input--sm" value={String(node.method || "GET")} onChange={(e) => update({ method: e.target.value })}>
            {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.http_url")}</label>
          <input className="input input--sm" value={String(node.url || "")} onChange={(e) => update({ url: e.target.value })} placeholder="https://api.github.com/user" />
        </div>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.http_headers")}</label>
        <input className="input input--sm" value={node.headers ? JSON.stringify(node.headers) : ""} onChange={(e) => { try { update({ headers: JSON.parse(e.target.value) }); } catch { /* ignore */ } }} placeholder='{"Accept": "application/json"}' />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.http_body")}</label>
        <textarea className="input" rows={3} value={typeof node.body === "string" ? node.body : JSON.stringify(node.body || "", null, 2)} onChange={(e) => update({ body: e.target.value })} />
      </div>
    </>
  );
}

export const oauth_descriptor: FrontendNodeDescriptor = {
  node_type: "oauth",
  icon: "🔑",
  color: "#ff5722",
  shape: "rect",
  toolbar_label: "+ OAuth",
  output_schema: [
    { name: "status",  type: "number", description: "HTTP status code" },
    { name: "body",    type: "object", description: "Response body" },
    { name: "headers", type: "object", description: "Response headers" },
  ],
  input_schema: [
    { name: "url",     type: "string", description: "Request URL (override)" },
    { name: "headers", type: "object", description: "Additional headers" },
    { name: "body",    type: "object", description: "Request body" },
  ],
  create_default: () => ({ service_id: "", url: "", method: "GET" }),
  EditPanel: OauthEditPanel,
};
