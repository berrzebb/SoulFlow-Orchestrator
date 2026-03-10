import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["publish", "subscribe", "info"];

function MqttEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "publish");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{t(`node.action.${a}`)}</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.host")} required>
          <input className="input input--sm" required value={String(node.host || "")} onChange={(e) => update({ host: e.target.value })} placeholder="mqtt.example.com" aria-required="true" />
        </BuilderField>
      </BuilderRowPair>
      <BuilderRowPair>
        <BuilderField label={t("workflows.port")}>
          <input className="input input--sm" type="number" min={1} max={65535} value={String(node.port ?? 1883)} onChange={(e) => update({ port: Number(e.target.value) || 1883 })} />
        </BuilderField>
        <BuilderField label={t("workflows.mqtt_client_id")}>
          <input className="input input--sm" value={String(node.client_id || "")} onChange={(e) => update({ client_id: e.target.value })} placeholder="client-1" />
        </BuilderField>
      </BuilderRowPair>
      <BuilderRowPair>
        <BuilderField label={t("workflows.username")}>
          <input className="input input--sm" value={String(node.username || "")} onChange={(e) => update({ username: e.target.value })} placeholder="(optional)" />
        </BuilderField>
        <BuilderField label={t("workflows.password")}>
          <input className="input input--sm" type="password" value={String(node.password || "")} onChange={(e) => update({ password: e.target.value })} />
        </BuilderField>
      </BuilderRowPair>
      {action !== "info" && (
        <BuilderField label={t("workflows.mqtt_topic")} required>
          <input className="input input--sm" required value={String(node.topic || "")} onChange={(e) => update({ topic: e.target.value })} placeholder="sensors/temp" aria-required="true" />
        </BuilderField>
      )}
      {action === "publish" && (
        <>
          <BuilderField label={t("workflows.mqtt_message")} required>
            <input className="input input--sm" required value={String(node.message || "")} onChange={(e) => update({ message: e.target.value })} aria-required="true" />
          </BuilderField>
          <BuilderField label={t("workflows.mqtt_qos")}>
            <select className="input input--sm" value={String(node.qos ?? 0)} onChange={(e) => update({ qos: Number(e.target.value) })}>
              <option value="0">{t("workflows.mqtt_qos_0")}</option>
              <option value="1">{t("workflows.mqtt_qos_1")}</option>
              <option value="2">{t("workflows.mqtt_qos_2")}</option>
            </select>
          </BuilderField>
        </>
      )}
    </>
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
    { name: "result", type: "object", description: "node.mqtt.output.result" },
    { name: "success", type: "boolean", description: "node.mqtt.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.mqtt.input.action" },
    { name: "host", type: "string", description: "node.mqtt.input.host" },
    { name: "topic", type: "string", description: "node.mqtt.input.topic" },
  ],
  create_default: () => ({ action: "publish", host: "", port: 1883, client_id: "", username: "", password: "", topic: "", message: "", qos: 0 }),
  EditPanel: MqttEditPanel,
};
