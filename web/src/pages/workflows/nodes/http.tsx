import { useState } from "react";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function HttpEditPanel({ node, update, t }: EditPanelProps) {
  const [headersRaw, setHeadersRaw] = useState(node.headers ? JSON.stringify(node.headers, null, 2) : "");
  const [headersErr, setHeadersErr] = useState("");

  const handleHeaders = (val: string) => {
    setHeadersRaw(val);
    if (!val.trim()) { setHeadersErr(""); update({ headers: undefined }); return; }
    try { update({ headers: JSON.parse(val) }); setHeadersErr(""); }
    catch { setHeadersErr("Invalid JSON"); }
  };

  return (
    <>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.http_method")}</label>
          <select className="input input--sm" value={String(node.method || "GET")} onChange={(e) => update({ method: e.target.value })}>
            {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.http_url")}</label>
          <input className="input input--sm" value={String(node.url || "")} onChange={(e) => update({ url: e.target.value })} placeholder="https://api.example.com/data" />
        </div>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.http_headers")}</label>
        <textarea
          className={`input input--sm code-textarea${headersErr ? " input--err" : ""}`}
          rows={2}
          value={headersRaw}
          onChange={(e) => handleHeaders(e.target.value)}
          placeholder='{"Authorization": "Bearer {{memory.token}}"}'
        />
        {headersErr && <span className="field-error">{headersErr}</span>}
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.http_body")}</label>
        <textarea className="input" rows={3} value={typeof node.body === "string" ? node.body : JSON.stringify(node.body || "", null, 2)} onChange={(e) => update({ body: e.target.value })} />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.timeout_ms")}</label>
        <input className="input input--sm" type="number" min={100} max={30000} step={1000} value={String(node.timeout_ms ?? 10000)} onChange={(e) => update({ timeout_ms: Number(e.target.value) || 10000 })} />
        <span className="builder-hint">{t("workflows.timeout_ms_hint")}</span>
      </div>
    </>
  );
}

export const http_descriptor: FrontendNodeDescriptor = {
  node_type: "http",
  icon: "↗",
  color: "#3498db",
  shape: "rect",
  toolbar_label: "+ HTTP",
  category: "integration",
  output_schema: [
    { name: "status",       type: "number",  description: "HTTP status code" },
    { name: "body",         type: "object",  description: "Response body" },
    { name: "content_type", type: "string",  description: "Content-Type" },
    { name: "headers",      type: "object",  description: "Response headers" },
  ],
  input_schema: [
    { name: "url",     type: "string", description: "Request URL" },
    { name: "headers", type: "object", description: "Request headers" },
    { name: "body",    type: "object", description: "Request body" },
  ],
  create_default: () => ({ url: "", method: "GET" }),
  EditPanel: HttpEditPanel,
};
