import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function WebsocketEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.websocket.description")}</label>
        <p className="builder-hint">{t("node.websocket.hint")}</p>
      </div>
    </>
  );
}

export const websocket_descriptor: FrontendNodeDescriptor = {
  node_type: "websocket",
  icon: "🔌",
  color: "#ff9800",
  shape: "rect",
  toolbar_label: "node.websocket.label",
  category: "integration",
  output_schema: [
    { name: "result", type: "string", description: "node.websocket.output.result" },
    { name: "success", type: "boolean", description: "node.websocket.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.websocket.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: WebsocketEditPanel,
};
