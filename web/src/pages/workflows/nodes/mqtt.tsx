import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function MqttEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <BuilderField label={t("node.mqtt.description")} hint={t("node.mqtt.hint")}>
      {null}
    </BuilderField>
  );
}

export const mqtt_descriptor: FrontendNodeDescriptor = {
  node_type: "mqtt",
  icon: "📡",
  color: "#660099",
  shape: "rect",
  toolbar_label: "node.mqtt.label",
  category: "integration",
  output_schema: [
    { name: "result", type: "string", description: "node.mqtt.output.result" },
    { name: "success", type: "boolean", description: "node.mqtt.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.mqtt.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: MqttEditPanel,
};
