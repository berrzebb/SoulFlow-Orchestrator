import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function GraphEditPanel({ t }: EditPanelProps) {
  return (
    <BuilderField label={t("node.graph.description")} hint={t("node.graph.hint")}>
      {null}
    </BuilderField>
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
