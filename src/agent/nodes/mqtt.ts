/** MQTT 노드 핸들러 — 워크플로우에서 MQTT 메시지 발행/구독. */

import type { NodeHandler } from "../node-registry.js";
import type { MqttNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const mqtt_handler: NodeHandler = {
  node_type: "mqtt",
  icon: "\u{1F4E1}",
  color: "#660099",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "MQTT operation result" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "publish / subscribe / info" },
    { name: "host", type: "string", description: "MQTT broker host" },
    { name: "topic", type: "string", description: "MQTT topic" },
  ],
  create_default: () => ({ action: "publish", host: "", topic: "", message: "", port: 1883 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as MqttNodeDefinition;
    try {
      const { MqttTool } = await import("../tools/mqtt.js");
      const tool = new MqttTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "publish",
        host: resolve_templates(n.host || "", tpl),
        port: n.port || 1883,
        topic: resolve_templates(n.topic || "", tpl),
        message: n.message ? resolve_templates(n.message, tpl) : undefined,
        username: n.username ? resolve_templates(n.username, tpl) : undefined,
        password: n.password ? resolve_templates(n.password, tpl) : undefined,
        qos: n.qos,
      });
      const parsed = result.startsWith("{") ? JSON.parse(result) : {};
      return { output: { result: parsed, success: parsed.success !== false } };
    } catch {
      return { output: { result: null, success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as MqttNodeDefinition;
    const warnings: string[] = [];
    if (!n.host) warnings.push("host is required");
    if (!n.topic) warnings.push("topic is required");
    return { preview: { action: n.action, host: n.host, topic: n.topic }, warnings };
  },
};
