import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function DurationEditPanel({ t }: EditPanelProps) {
  return (
    <BuilderField label={t("node.duration.description")} hint={t("node.duration.hint")}>
      {null}
    </BuilderField>
  );
}

export const duration_descriptor: FrontendNodeDescriptor = {
  node_type: "duration",
  icon: "⏱️",
  color: "#00897b",
  shape: "rect",
  toolbar_label: "node.duration.label",
  category: "data",
  output_schema: [
    { name: "result", type: "string", description: "node.duration.output.result" },
    { name: "success", type: "boolean", description: "node.duration.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.duration.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: DurationEditPanel,
};
