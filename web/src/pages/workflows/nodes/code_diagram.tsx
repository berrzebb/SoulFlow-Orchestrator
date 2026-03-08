import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function CodeDiagramEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.code_diagram.description")}</label>
        <p className="builder-hint">{t("node.code_diagram.hint")}</p>
      </div>
    </>
  );
}

export const code_diagram_descriptor: FrontendNodeDescriptor = {
  node_type: "code_diagram",
  icon: "📊",
  color: "#6a1b9a",
  shape: "rect",
  toolbar_label: "node.code_diagram.label",
  category: "advanced",
  output_schema: [
    { name: "result", type: "string", description: "node.code_diagram.output.result" },
    { name: "success", type: "boolean", description: "node.code_diagram.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.code_diagram.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: CodeDiagramEditPanel,
};
