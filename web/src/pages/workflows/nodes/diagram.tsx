import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function DiagramEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.diagram.input.source")}</label>
        <input className="input input--sm" value={String(node.source || "")} onChange={(e) => update({ source: e.target.value })} />
      </div>
      <div className="builder-row">
        <label className="label">{t("node.diagram.input.type")}</label>
        <input className="input input--sm" value={String(node.type || "")} onChange={(e) => update({ type: e.target.value })} />
      </div>
    </>
  );
}

export const diagram_descriptor: FrontendNodeDescriptor = {
  node_type: "diagram",
  icon: "📊",
  color: "#00897b",
  shape: "rect",
  toolbar_label: "node.diagram.label",
  category: "advanced",
  output_schema: [
    { name: "output", type: "string", description: "node.diagram.output.output" },
    { name: "format", type: "string", description: "node.diagram.output.format" },
    { name: "success", type: "boolean", description: "node.diagram.output.success" },
  ],
  input_schema: [
    { name: "source", type: "string", description: "node.diagram.input.source" },
    { name: "type", type: "string", description: "node.diagram.input.type" },
  ],
  create_default: () => ({ source: "", type: "" }),
  EditPanel: DiagramEditPanel,
};
