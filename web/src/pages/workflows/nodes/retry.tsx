import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function RetryEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("workflows.retry_target")} hint={t("workflows.retry_target_hint")}>
        <input autoFocus className="input input--sm" value={String(node.target_node || "")} onChange={(e) => update({ target_node: e.target.value })} placeholder="node_id" aria-label={t("workflows.retry_target")} />
      </BuilderField>
      <BuilderRowPair>
        <BuilderField label={t("workflows.retry_max_attempts")} hint={t("workflows.retry_max_attempts_hint")}>
          <input className="input input--sm" type="number" min={1} max={10} value={String(node.max_attempts ?? 3)} onChange={(e) => update({ max_attempts: Number(e.target.value) })} aria-label={t("workflows.retry_max_attempts")} />
        </BuilderField>
        <BuilderField label={t("workflows.retry_backoff")}>
          <select className="input input--sm" value={String(node.backoff || "exponential")} onChange={(e) => update({ backoff: e.target.value })} aria-label={t("workflows.retry_backoff")}>
            <option value="exponential">{t("workflows.opt_exponential")}</option>
            <option value="linear">{t("workflows.opt_linear")}</option>
            <option value="fixed">{t("workflows.opt_fixed")}</option>
          </select>
        </BuilderField>
      </BuilderRowPair>
      <BuilderRowPair>
        <BuilderField label={t("workflows.retry_initial_delay")} hint={t("workflows.retry_initial_delay_hint")}>
          <input className="input input--sm" type="number" min={100} value={String(node.initial_delay_ms ?? 1000)} onChange={(e) => update({ initial_delay_ms: Number(e.target.value) })} aria-label={t("workflows.retry_initial_delay")} />
        </BuilderField>
        <BuilderField label={t("workflows.retry_max_delay")} hint={t("workflows.retry_max_delay_hint")}>
          <input className="input input--sm" type="number" min={1000} value={String(node.max_delay_ms ?? 30000)} onChange={(e) => update({ max_delay_ms: Number(e.target.value) })} aria-label={t("workflows.retry_max_delay")} />
        </BuilderField>
      </BuilderRowPair>
    </>
  );
}

export const retry_descriptor: FrontendNodeDescriptor = {
  node_type: "retry",
  icon: "🔄",
  color: "#ff5722",
  shape: "rect",
  toolbar_label: "node.retry.label",
  category: "flow",
  output_schema: [
    { name: "result",     type: "unknown", description: "node.retry.output.result" },
    { name: "attempts",   type: "number",  description: "node.retry.output.attempts" },
    { name: "succeeded",  type: "boolean", description: "node.retry.output.succeeded" },
    { name: "last_error", type: "string",  description: "node.retry.output.last_error" },
  ],
  input_schema: [
    { name: "target_output", type: "unknown", description: "node.retry.input.target_output" },
    { name: "target_error",  type: "string",  description: "node.retry.input.target_error" },
  ],
  create_default: () => ({ target_node: "", max_attempts: 3, backoff: "exponential", initial_delay_ms: 1000, max_delay_ms: 30000 }),
  EditPanel: RetryEditPanel,
};
