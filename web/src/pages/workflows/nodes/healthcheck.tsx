import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function HealthcheckEditPanel({ t }: EditPanelProps) {
  return (
    <BuilderField label={t("node.healthcheck.description")} hint={t("node.healthcheck.hint")}>
      {null}
    </BuilderField>
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
    { name: "data", type: "string", description: "node.healthcheck.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: HealthcheckEditPanel,
};
