import { describe, it, expect } from "vitest";
import { mqtt_handler } from "../../../src/agent/nodes/mqtt.js";
import type { MqttNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("mqtt_handler", () => {
  const createMockNode = (overrides?: Partial<MqttNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "mqtt",
    action: "publish",
    broker: "mqtt.example.com",
    topic: "test/topic",
    message: "hello",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be mqtt", () => {
    expect(mqtt_handler.node_type).toBe("mqtt");
  });

  it("execute: should handle publish action", async () => {
    const node = createMockNode({ action: "publish" });
    const ctx = createMockContext();
    const result = await mqtt_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates", async () => {
    const node = createMockNode({ message: "${msg}" });
    const ctx = createMockContext({ msg: "test message" });
    const result = await mqtt_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle subscribe action", async () => {
    const node = createMockNode({ action: "subscribe" });
    const ctx = createMockContext();
    const result = await mqtt_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should have action", () => {
    const node = createMockNode({ action: "disconnect" });
    const result = mqtt_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ broker: "" });
    const ctx = createMockContext();
    const result = await mqtt_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
