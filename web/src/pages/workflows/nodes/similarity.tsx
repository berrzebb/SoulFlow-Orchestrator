import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function SimilarityEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.similarity.description")}</label>
        <p className="builder-hint">{t("node.similarity.hint")}</p>
      </div>
    </>
  );
}

export const similarity_descriptor: FrontendNodeDescriptor = {
  node_type: "similarity",
  icon: "🔍",
  color: "#4a148c",
  shape: "rect",
  toolbar_label: "node.similarity.label",
  category: "advanced",
  output_schema: [
    { name: "result", type: "string", description: "node.similarity.output.result" },
    { name: "success", type: "boolean", description: "node.similarity.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.similarity.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: SimilarityEditPanel,
};
