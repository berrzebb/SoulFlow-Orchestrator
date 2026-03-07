import { useState } from "react";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const CUSTOM_SENTINEL = "__custom__";

function OauthEditPanel({ node, update, t, options }: EditPanelProps) {
  const integrations = options?.oauth_integrations || [];
  const current = String(node.service_id || "");
  const is_custom = current === CUSTOM_SENTINEL || (current !== "" && !integrations.some((i) => i.instance_id === current));
  const [headersRaw, setHeadersRaw] = useState(node.headers ? JSON.stringify(node.headers, null, 2) : "");
  const [headersErr, setHeadersErr] = useState("");

  const handleHeaders = (val: string) => {
    setHeadersRaw(val);
    if (!val.trim()) { setHeadersErr(""); update({ headers: undefined }); return; }
    try { update({ headers: JSON.parse(val) }); setHeadersErr(""); }
    catch { setHeadersErr(t("workflows.invalid_json")); }
  };

  const handleServiceChange = (val: string) => {
    if (val === CUSTOM_SENTINEL) {
      update({ service_id: CUSTOM_SENTINEL, auth_url: "", token_url: "", client_id: "", scopes: "" });
    } else {
      update({ service_id: val, auth_url: undefined, token_url: undefined, client_id: undefined, client_secret: undefined, scopes: undefined });
    }
  };

  return (
    <>
      {/* Service 선택 */}
      <div className="builder-row">
        <label className="label">{t("workflows.oauth_service")}</label>
        <select className="input input--sm" value={is_custom ? CUSTOM_SENTINEL : current} onChange={(e) => handleServiceChange(e.target.value)}>
          <option value="">{t("common.select")}</option>
          {integrations.map((i) => (
            <option key={i.instance_id} value={i.instance_id}>
              {i.label || i.instance_id} ({i.service_type})
            </option>
          ))}
          <option value={CUSTOM_SENTINEL}>{t("workflows.oauth_custom")}</option>
        </select>
      </div>

      {/* Custom OAuth 설정 필드 */}
      {is_custom && (
        <>
          <div className="builder-row-pair">
            <div className="builder-row">
              <label className="label">{t("workflows.oauth_auth_url")}</label>
              <input className="input input--sm" value={String(node.auth_url || "")} onChange={(e) => update({ auth_url: e.target.value })} placeholder="https://example.com/oauth/authorize" />
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.oauth_token_url")}</label>
              <input className="input input--sm" value={String(node.token_url || "")} onChange={(e) => update({ token_url: e.target.value })} placeholder="https://example.com/oauth/token" />
            </div>
          </div>
          <div className="builder-row-pair">
            <div className="builder-row">
              <label className="label">{t("workflows.oauth_client_id")}</label>
              <input className="input input--sm" value={String(node.client_id || "")} onChange={(e) => update({ client_id: e.target.value })} placeholder="client_id" />
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.oauth_client_secret")}</label>
              <input className="input input--sm" type="password" value={String(node.client_secret || "")} onChange={(e) => update({ client_secret: e.target.value })} placeholder="••••••••" />
            </div>
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.oauth_scopes")}</label>
            <input className="input input--sm" value={String(node.scopes || "")} onChange={(e) => update({ scopes: e.target.value })} placeholder="read write (space-separated)" />
          </div>
        </>
      )}

      {/* HTTP 설정 */}
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
        <textarea
          className={`input input--sm code-textarea${headersErr ? " input--err" : ""}`}
          rows={2}
          value={headersRaw}
          onChange={(e) => handleHeaders(e.target.value)}
          placeholder='{"Accept": "application/json"}'
        />
        {headersErr && <span className="field-error">{headersErr}</span>}
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
  toolbar_label: "node.oauth.label",
  category: "integration",
  output_schema: [
    { name: "status",  type: "number", description: "node.oauth.output.status" },
    { name: "body",    type: "object", description: "node.oauth.output.body" },
    { name: "headers", type: "object", description: "node.oauth.output.headers" },
  ],
  input_schema: [
    { name: "url",     type: "string", description: "node.oauth.input.url" },
    { name: "headers", type: "object", description: "node.oauth.input.headers" },
    { name: "body",    type: "object", description: "node.oauth.input.body" },
  ],
  create_default: () => ({ service_id: "", url: "", method: "GET" }),
  EditPanel: OauthEditPanel,
};
