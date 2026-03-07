/** MQTT 도구 — MQTT 메시지 발행/구독 (raw TCP 프로토콜). */

import { createConnection, type Socket } from "node:net";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class MqttTool extends Tool {
  readonly name = "mqtt";
  readonly category = "external" as const;
  readonly description = "MQTT client: publish, subscribe (single message), info.";
  readonly policy_flags = { network: true, write: true };
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["publish", "subscribe", "info"], description: "MQTT operation" },
      host: { type: "string", description: "MQTT broker host" },
      port: { type: "integer", description: "MQTT broker port (default: 1883)" },
      topic: { type: "string", description: "MQTT topic" },
      message: { type: "string", description: "Message payload (publish)" },
      client_id: { type: "string", description: "Client ID (default: auto)" },
      username: { type: "string", description: "MQTT username" },
      password: { type: "string", description: "MQTT password" },
      timeout_ms: { type: "integer", description: "Timeout in ms (default: 10000)" },
      qos: { type: "integer", description: "QoS level 0/1/2 (default: 0)" },
    },
    required: ["action", "host"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "publish");
    const host = String(params.host || "");
    if (!host) return "Error: host is required";
    const port = Number(params.port) || 1883;
    const topic = String(params.topic || "");
    const client_id = String(params.client_id || `sf_${Date.now()}`);
    const timeout = Math.min(Number(params.timeout_ms) || 10000, 30000);
    const qos = Math.max(0, Math.min(Number(params.qos) || 0, 2));

    switch (action) {
      case "publish": {
        if (!topic) return "Error: topic is required";
        const message = String(params.message || "");
        return this.mqtt_publish(host, port, client_id, topic, message, qos, timeout, params);
      }
      case "subscribe": {
        if (!topic) return "Error: topic is required";
        return this.mqtt_subscribe(host, port, client_id, topic, qos, timeout, params);
      }
      case "info":
        return JSON.stringify({ host, port, client_id, note: "MQTT connection test — use publish/subscribe for actual operations" });
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private build_connect_packet(client_id: string, params: Record<string, unknown>): Buffer {
    const protocol = Buffer.from([0x00, 0x04, 0x4D, 0x51, 0x54, 0x54, 0x04]);
    const client_buf = Buffer.from(client_id, "utf-8");
    let flags = 0x02;
    const payload_parts: Buffer[] = [Buffer.alloc(2), client_buf];
    payload_parts[0]!.writeUInt16BE(client_buf.length);

    if (params.username) {
      flags |= 0x80;
      const user_buf = Buffer.from(String(params.username), "utf-8");
      const user_len = Buffer.alloc(2);
      user_len.writeUInt16BE(user_buf.length);
      payload_parts.push(user_len, user_buf);
    }
    if (params.password) {
      flags |= 0x40;
      const pass_buf = Buffer.from(String(params.password), "utf-8");
      const pass_len = Buffer.alloc(2);
      pass_len.writeUInt16BE(pass_buf.length);
      payload_parts.push(pass_len, pass_buf);
    }

    const variable_header = Buffer.concat([protocol, Buffer.from([flags, 0x00, 0x3C])]);
    const payload = Buffer.concat(payload_parts);
    const remaining = variable_header.length + payload.length;
    return Buffer.concat([Buffer.from([0x10, remaining]), variable_header, payload]);
  }

  private mqtt_publish(host: string, port: number, client_id: string, topic: string, message: string, qos: number, timeout: number, params: Record<string, unknown>): Promise<string> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { socket.destroy(); resolve("Error: timeout"); }, timeout);
      const socket: Socket = createConnection(port, host, () => {
        socket.write(this.build_connect_packet(client_id, params));
      });
      socket.once("data", () => {
        const topic_buf = Buffer.from(topic, "utf-8");
        const msg_buf = Buffer.from(message, "utf-8");
        const topic_len = Buffer.alloc(2);
        topic_len.writeUInt16BE(topic_buf.length);
        const remaining = 2 + topic_buf.length + msg_buf.length;
        const publish = Buffer.concat([Buffer.from([0x30 | (qos << 1), remaining]), topic_len, topic_buf, msg_buf]);
        socket.write(publish);
        socket.write(Buffer.from([0xE0, 0x00]));
        clearTimeout(timer);
        socket.destroy();
        resolve(JSON.stringify({ success: true, topic, message_length: message.length }));
      });
      socket.on("error", (err: Error) => { clearTimeout(timer); resolve(JSON.stringify({ success: false, error: err.message })); });
    });
  }

  private mqtt_subscribe(host: string, port: number, client_id: string, topic: string, qos: number, timeout: number, params: Record<string, unknown>): Promise<string> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { socket.destroy(); resolve(JSON.stringify({ success: false, error: "timeout — no message received" })); }, timeout);
      let connected = false;
      const socket: Socket = createConnection(port, host, () => {
        socket.write(this.build_connect_packet(client_id, params));
      });
      socket.on("data", (data: Buffer) => {
        if (!connected) {
          connected = true;
          const topic_buf = Buffer.from(topic, "utf-8");
          const topic_len = Buffer.alloc(2);
          topic_len.writeUInt16BE(topic_buf.length);
          const packet_id = Buffer.from([0x00, 0x01]);
          const remaining = 2 + 2 + topic_buf.length + 1;
          const subscribe = Buffer.concat([Buffer.from([0x82, remaining]), packet_id, topic_len, topic_buf, Buffer.from([qos])]);
          socket.write(subscribe);
          return;
        }
        if ((data[0]! & 0xF0) === 0x30) {
          const topic_len = data.readUInt16BE(2);
          const payload_start = 4 + topic_len;
          const payload = data.slice(payload_start).toString("utf-8");
          clearTimeout(timer);
          socket.destroy();
          resolve(JSON.stringify({ success: true, topic, message: payload }));
        }
      });
      socket.on("error", (err: Error) => { clearTimeout(timer); resolve(JSON.stringify({ success: false, error: err.message })); });
    });
  }
}
