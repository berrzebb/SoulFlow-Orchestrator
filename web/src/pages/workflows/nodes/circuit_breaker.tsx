import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function CircuitBreakerEditPanel({ t }: EditPanelProps) {
  return (
    <BuilderField label={t("node.circuit_breaker.description")} hint={t("node.circuit_breaker.hint")}>
      {null}
    </BuilderField>
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
    { name: "result", type: "string", description: "node.circuit_breaker.output.result" },
    { name: "success", type: "boolean", description: "node.circuit_breaker.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.circuit_breaker.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: CircuitBreakerEditPanel,
};
