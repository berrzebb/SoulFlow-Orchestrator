import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["create", "record_success", "record_failure", "get_state", "reset", "stats", "config"];

function CircuitBreakerEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "get_state");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{t(`node.action.${a}`)}</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.circuit_breaker_name")} required>
          <input className="input input--sm" required value={String(node.name || "")} onChange={(e) => update({ name: e.target.value })} placeholder="my-service" aria-required="true" />
        </BuilderField>
      </BuilderRowPair>
      {(action === "create" || action === "config") && (
        <>
          <BuilderRowPair>
            <BuilderField label={t("workflows.circuit_breaker_threshold")}>
              <input className="input input--sm" type="number" min={1} value={String(node.threshold ?? 5)} onChange={(e) => update({ threshold: Number(e.target.value) || 5 })} />
            </BuilderField>
            <BuilderField label={t("workflows.timeout_ms")}>
              <input className="input input--sm" type="number" min={1000} value={String(node.timeout_ms ?? 30000)} onChange={(e) => update({ timeout_ms: Number(e.target.value) || 30000 })} />
            </BuilderField>
          </BuilderRowPair>
          <BuilderField label={t("workflows.circuit_breaker_half_open_max")}>
            <input className="input input--sm" type="number" min={1} value={String(node.half_open_max ?? 1)} onChange={(e) => update({ half_open_max: Number(e.target.value) || 1 })} />
          </BuilderField>
        </>
      )}
    </>
  );
}

export const circuit_breaker_descriptor: FrontendNodeDescriptor = {
  node_type: "circuit_breaker",
  icon: "⚡",
  color: "#e65100",
  shape: "rect",
  toolbar_label: "node.circuit_breaker.label",
  category: "advanced",
  output_schema: [
    { name: "result", type: "object", description: "node.circuit_breaker.output.result" },
    { name: "success", type: "boolean", description: "node.circuit_breaker.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.circuit_breaker.input.action" },
    { name: "name", type: "string", description: "node.circuit_breaker.input.name" },
  ],
  create_default: () => ({ action: "get_state", name: "", threshold: 5, timeout_ms: 30000, half_open_max: 1 }),
  EditPanel: CircuitBreakerEditPanel,
};
