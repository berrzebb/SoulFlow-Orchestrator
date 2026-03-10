import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["list", "get", "put", "delete", "head", "presign"];

function S3EditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "list");
  const needs_key = ["get", "put", "delete", "head", "presign"].includes(action);
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.s3_bucket")} required>
          <input className="input input--sm" required value={String(node.bucket || "")} onChange={(e) => update({ bucket: e.target.value })} placeholder="my-bucket" aria-required="true" />
        </BuilderField>
      </BuilderRowPair>
      {action === "list" && (
        <BuilderField label={t("workflows.s3_prefix")}>
          <input className="input input--sm" value={String(node.prefix || "")} onChange={(e) => update({ prefix: e.target.value })} placeholder="folder/subfolder/" />
        </BuilderField>
      )}
      {needs_key && (
        <BuilderField label={t("workflows.field_key")} required>
          <input className="input input--sm" required value={String(node.key || "")} onChange={(e) => update({ key: e.target.value })} placeholder="path/to/file.txt" aria-required="true" />
        </BuilderField>
      )}
      {action === "put" && (
        <BuilderField label={t("workflows.field_body")}>
          <textarea className="input" rows={3} value={String(node.body || "")} onChange={(e) => update({ body: e.target.value })} placeholder="file content" />
        </BuilderField>
      )}
      <BuilderRowPair>
        <BuilderField label={t("workflows.field_region")}>
          <input className="input input--sm" value={String(node.region || "us-east-1")} onChange={(e) => update({ region: e.target.value })} placeholder="us-east-1" />
        </BuilderField>
        <BuilderField label={t("workflows.field_endpoint")}>
          <input className="input input--sm" value={String(node.endpoint || "")} onChange={(e) => update({ endpoint: e.target.value })} placeholder="https://s3.amazonaws.com" />
        </BuilderField>
      </BuilderRowPair>
      <BuilderRowPair>
        <BuilderField label={t("workflows.s3_access_key")}>
          <input className="input input--sm" value={String(node.access_key || "")} onChange={(e) => update({ access_key: e.target.value })} />
        </BuilderField>
        <BuilderField label={t("workflows.s3_secret_key")}>
          <input className="input input--sm" type="password" value={String(node.secret_key || "")} onChange={(e) => update({ secret_key: e.target.value })} />
        </BuilderField>
      </BuilderRowPair>
    </>
  );
}

export const s3_descriptor: FrontendNodeDescriptor = {
  node_type: "s3",
  icon: "📦",
  color: "#ff9900",
  shape: "rect",
  toolbar_label: "node.s3.label",
  category: "integration",
  output_schema: [
    { name: "result", type: "object", description: "node.s3.output.result" },
    { name: "success", type: "boolean", description: "node.s3.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.s3.input.action" },
    { name: "bucket", type: "string", description: "node.s3.input.bucket" },
    { name: "key", type: "string", description: "node.s3.input.key" },
  ],
  create_default: () => ({ action: "list", bucket: "", key: "", prefix: "", region: "us-east-1", endpoint: "", access_key: "", secret_key: "" }),
  EditPanel: S3EditPanel,
};
