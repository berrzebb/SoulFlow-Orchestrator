import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function DurationEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.duration.description")}</label>
        <p className="builder-hint">{t("node.duration.hint")}</p>
      </div>
    </>
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
