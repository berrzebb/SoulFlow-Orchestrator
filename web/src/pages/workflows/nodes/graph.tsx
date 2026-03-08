import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function GraphEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.graph.description")}</label>
        <p className="builder-hint">{t("node.graph.hint")}</p>
      </div>
    </>
  );
}

export const graph_descriptor: FrontendNodeDescriptor = {
  node_type: "graph",
  icon: "🕸️",
  color: "#1a237e",
  shape: "rect",
  toolbar_label: "node.graph.label",
  category: "advanced",
  output_schema: [
    { name: "result", type: "string", description: "node.graph.output.result" },
    { name: "success", type: "boolean", description: "node.graph.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.graph.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: GraphEditPanel,
};
