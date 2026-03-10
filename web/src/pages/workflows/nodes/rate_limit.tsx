import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["check", "consume", "status", "reset", "list"];
const ALGORITHMS = ["token_bucket", "sliding_window"];

function RateLimitEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "check");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.field_algorithm")}>
          <select className="input input--sm" value={String(node.algorithm || "token_bucket")} onChange={(e) => update({ algorithm: e.target.value })}>
            {ALGORITHMS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
      </BuilderRowPair>
      {action !== "list" && (
        <BuilderField label={t("workflows.field_key")} required>
          <input className="input input--sm" required value={String(node.key || "")} onChange={(e) => update({ key: e.target.value })} placeholder="user:123" aria-required="true" />
        </BuilderField>
      )}
      {(action === "check" || action === "consume") && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.rate_limit_max_requests")}>
            <input className="input input--sm" type="number" min={1} value={String(node.max_requests ?? 60)} onChange={(e) => update({ max_requests: Number(e.target.value) || 60 })} />
          </BuilderField>
          <BuilderField label={t("workflows.rate_limit_window_ms")}>
            <input className="input input--sm" type="number" min={1000} value={String(node.window_ms ?? 60000)} onChange={(e) => update({ window_ms: Number(e.target.value) || 60000 })} />
          </BuilderField>
        </BuilderRowPair>
      )}
    </>
  );
}

export const rate_limit_descriptor: FrontendNodeDescriptor = {
  node_type: "rate_limit",
  icon: "⏱",
  color: "#795548",
  shape: "rect",
  toolbar_label: "node.rate_limit.label",
  category: "advanced",
  output_schema: [
    { name: "allowed",   type: "boolean", description: "node.rate_limit.output.allowed" },
    { name: "remaining", type: "number",  description: "node.rate_limit.output.remaining" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.rate_limit.input.action" },
    { name: "key", type: "string", description: "node.rate_limit.input.key" },
  ],
  create_default: () => ({ action: "check", key: "", max_requests: 60, window_ms: 60000, algorithm: "token_bucket" }),
  EditPanel: RateLimitEditPanel,
};
