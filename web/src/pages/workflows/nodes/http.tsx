import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair, JsonField } from "../builder-field";

function HttpEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.http_method")} required>
          <select autoFocus className="input input--sm" required value={String(node.method || "GET")} onChange={(e) => update({ method: e.target.value })} aria-required="true">
            {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.http_url")} required>
          <input className="input input--sm" required value={String(node.url || "")} onChange={(e) => update({ url: e.target.value })} placeholder="https://api.example.com/data" aria-required="true" />
        </BuilderField>
      </BuilderRowPair>
      <JsonField label={t("workflows.http_headers")} value={node.headers} onUpdate={(v) => update({ headers: v })} rows={2} small placeholder='{"Authorization": "Bearer {{memory.token}}"}'  />
      <BuilderField label={t("workflows.http_body")}>
        <textarea className="input" rows={3} value={typeof node.body === "string" ? node.body : (node.body != null ? JSON.stringify(node.body, null, 2) : "")} onChange={(e) => update({ body: e.target.value })} />
      </BuilderField>
      <BuilderRowPair>
        <BuilderField label={t("workflows.http_user_agent")}>
          <input className="input input--sm" value={String(node.user_agent || "")} onChange={(e) => update({ user_agent: e.target.value || undefined })} placeholder="(browser default)" list="http-ua-presets" />
          <datalist id="http-ua-presets">
            <option value="Mozilla/5.0 (compatible; SoulFlowBot/1.0)" />
            <option value="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36" />
            <option value="curl/7.88.0" />
            <option value="PostmanRuntime/7.36.0" />
          </datalist>
        </BuilderField>
        <BuilderField label={t("workflows.timeout_ms")} required hint={t("workflows.timeout_ms_hint")}>
          <input className="input input--sm" required type="number" min={100} max={30000} step={1000} value={String(node.timeout_ms ?? 10000)} onChange={(e) => update({ timeout_ms: Number(e.target.value) || 10000 })} aria-required="true" />
        </BuilderField>
      </BuilderRowPair>
    </>
  );
}

export const http_descriptor: FrontendNodeDescriptor = {
  node_type: "http",
  icon: "↗",
  color: "#3498db",
  shape: "rect",
  toolbar_label: "node.http.label",
  category: "integration",
  output_schema: [
    { name: "status",       type: "number",  description: "node.http.output.status" },
    { name: "body",         type: "object",  description: "node.http.output.body" },
    { name: "content_type", type: "string",  description: "node.http.output.content_type" },
    { name: "headers",      type: "object",  description: "node.http.output.headers" },
  ],
  input_schema: [
    { name: "url",     type: "string", description: "node.http.input.url" },
    { name: "headers", type: "object", description: "node.http.input.headers" },
    { name: "body",    type: "object", description: "node.http.input.body" },
  ],
  create_default: () => ({ url: "", method: "GET", timeout_ms: 10000 }),
  EditPanel: HttpEditPanel,
};
