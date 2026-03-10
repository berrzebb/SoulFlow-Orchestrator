import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["http", "tcp", "dns", "multi", "ping"];

function HealthcheckEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "http");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
        {action === "http" ? (
          <BuilderField label={t("workflows.field_url")} required>
            <input className="input input--sm" required value={String(node.url || "")} onChange={(e) => update({ url: e.target.value })} placeholder="https://example.com/health" aria-required="true" />
          </BuilderField>
        ) : (
          <BuilderField label={t("workflows.host")} required>
            <input className="input input--sm" required value={String(node.host || "")} onChange={(e) => update({ host: e.target.value })} placeholder="example.com" aria-required="true" />
          </BuilderField>
        )}
      </BuilderRowPair>
      {(action === "tcp" || action === "dns") && (
        <BuilderField label={t("workflows.port")}>
          <input className="input input--sm" type="number" min={1} max={65535} value={String(node.port ?? "")} onChange={(e) => update({ port: e.target.value ? Number(e.target.value) : undefined })} placeholder="80" />
        </BuilderField>
      )}
      <BuilderField label={t("workflows.timeout_ms")}>
        <input className="input input--sm" type="number" min={100} value={String(node.timeout_ms ?? 5000)} onChange={(e) => update({ timeout_ms: Number(e.target.value) || 5000 })} />
      </BuilderField>
    </>
  );
}

export const healthcheck_descriptor: FrontendNodeDescriptor = {
  node_type: "healthcheck",
  icon: "🏥",
  color: "#2e7d32",
  shape: "rect",
  toolbar_label: "node.healthcheck.label",
  category: "advanced",
  output_schema: [
    { name: "result", type: "string", description: "node.healthcheck.output.result" },
    { name: "success", type: "boolean", description: "node.healthcheck.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.healthcheck.input.action" },
    { name: "target", type: "string", description: "node.healthcheck.input.target" },
  ],
  create_default: () => ({ action: "http", target: "", timeout_ms: 5000 }),
  EditPanel: HealthcheckEditPanel,
};
