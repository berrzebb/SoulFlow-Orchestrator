import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function DataMaskEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.data_mask.description")}</label>
        <p className="builder-hint">{t("node.data_mask.hint")}</p>
      </div>
    </>
  );
}

export const data_mask_descriptor: FrontendNodeDescriptor = {
  node_type: "data_mask",
  icon: "🎭",
  color: "#b71c1c",
  shape: "rect",
  toolbar_label: "node.data_mask.label",
  category: "advanced",
  output_schema: [
    { name: "result", type: "string", description: "node.data_mask.output.result" },
    { name: "success", type: "boolean", description: "node.data_mask.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.data_mask.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: DataMaskEditPanel,
};
