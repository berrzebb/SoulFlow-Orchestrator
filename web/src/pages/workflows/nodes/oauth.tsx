import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair, JsonField } from "../builder-field";

const CUSTOM_SENTINEL = "__custom__";

function OauthEditPanel({ node, update, t, options }: EditPanelProps) {
  const integrations = options?.oauth_integrations || [];
  const current = String(node.service_id || "");
  const is_custom = current === CUSTOM_SENTINEL || (current !== "" && !integrations.some((i) => i.instance_id === current));
  const handleServiceChange = (val: string) => {
    if (val === CUSTOM_SENTINEL) {
      update({ service_id: CUSTOM_SENTINEL, auth_url: "", token_url: "", client_id: "", scopes: "" });
    } else {
      update({ service_id: val, auth_url: undefined, token_url: undefined, client_id: undefined, client_secret: undefined, scopes: undefined });
    }
  };

  return (
    <>
      <BuilderField label={t("workflows.oauth_service")}>
        <select autoFocus className="input input--sm" value={is_custom ? CUSTOM_SENTINEL : current} onChange={(e) => handleServiceChange(e.target.value)}>
          <option value="">{t("common.select")}</option>
          {integrations.map((i) => (
            <option key={i.instance_id} value={i.instance_id}>
              {i.label || i.instance_id} ({i.service_type})
            </option>
          ))}
          <option value={CUSTOM_SENTINEL}>{t("workflows.oauth_custom")}</option>
        </select>
      </BuilderField>

      {is_custom && (
        <>
          <BuilderRowPair>
            <BuilderField label={t("workflows.oauth_auth_url")}>
              <input className="input input--sm" value={String(node.auth_url || "")} onChange={(e) => update({ auth_url: e.target.value })} placeholder="https://example.com/oauth/authorize" />
            </BuilderField>
            <BuilderField label={t("workflows.oauth_token_url")}>
              <input className="input input--sm" value={String(node.token_url || "")} onChange={(e) => update({ token_url: e.target.value })} placeholder="https://example.com/oauth/token" />
            </BuilderField>
          </BuilderRowPair>
          <BuilderRowPair>
            <BuilderField label={t("workflows.oauth_client_id")}>
              <input className="input input--sm" value={String(node.client_id || "")} onChange={(e) => update({ client_id: e.target.value })} placeholder="client_id" />
            </BuilderField>
            <BuilderField label={t("workflows.oauth_client_secret")}>
              <input className="input input--sm" type="password" value={String(node.client_secret || "")} onChange={(e) => update({ client_secret: e.target.value })} placeholder="••••••••" />
            </BuilderField>
          </BuilderRowPair>
          <BuilderField label={t("workflows.oauth_scopes")}>
            <input className="input input--sm" value={String(node.scopes || "")} onChange={(e) => update({ scopes: e.target.value })} placeholder="read write (space-separated)" />
          </BuilderField>
        </>
      )}

      <BuilderRowPair>
        <BuilderField label={t("workflows.http_method")}>
          <select className="input input--sm" value={String(node.method || "GET")} onChange={(e) => update({ method: e.target.value })}>
            {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.http_url")}>
          <input className="input input--sm" value={String(node.url || "")} onChange={(e) => update({ url: e.target.value })} placeholder="https://api.github.com/user" />
        </BuilderField>
      </BuilderRowPair>
      <JsonField label={t("workflows.http_headers")} value={node.headers} onUpdate={(v) => update({ headers: v })} rows={2} small placeholder='{"Accept": "application/json"}' />
      <BuilderField label={t("workflows.http_body")}>
        <textarea className="input" rows={3} value={typeof node.body === "string" ? node.body : (node.body != null ? JSON.stringify(node.body, null, 2) : "")} onChange={(e) => update({ body: e.target.value })} />
      </BuilderField>
      <BuilderField label={t("workflows.timeout_ms")} hint={t("workflows.timeout_ms_hint")}>
        <input className="input input--sm" type="number" min={1000} value={String(node.timeout_ms ?? 10000)} onChange={(e) => update({ timeout_ms: Number(e.target.value) || 10000 })} />
      </BuilderField>
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
  create_default: () => ({ service_id: "", url: "", method: "GET", timeout_ms: 10000, auth_url: "", token_url: "", client_id: "", client_secret: "", scopes: "" }),
  EditPanel: OauthEditPanel,
};
