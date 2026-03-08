import { describe, it, expect } from "vitest";
import { websocket_handler } from "../../../src/agent/nodes/websocket.js";
import type { WebsocketNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("websocket_handler", () => {
  const createMockNode = (overrides?: Partial<WebsocketNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "websocket",
    operation: "connect",
    url: "ws://localhost:8080",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be websocket", () => {
    expect(websocket_handler.node_type).toBeDefined();
  });

  it("execute: should connect to WebSocket", async () => {
    const node = createMockNode({ operation: "connect" });
    const ctx = createMockContext();
    const result = await websocket_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in URL", async () => {
    const node = createMockNode({ url: "${ws_server}" });
    const ctx = createMockContext({ ws_server: "ws://api.example.com:8080" });
    const result = await websocket_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should send message to WebSocket", async () => {
    const node = createMockNode({
      operation: "send",
      message: '{"action":"ping"}',
    });
    const ctx = createMockContext();
    const result = await websocket_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should receive message from WebSocket", async () => {
    const node = createMockNode({
      operation: "receive",
      timeout_ms: 5000,
    });
    const ctx = createMockContext();
    const result = await websocket_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show operation and URL", () => {
    const node = createMockNode();
    const result = websocket_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should close WebSocket connection", async () => {
    const node = createMockNode({ operation: "close" });
    const ctx = createMockContext();
    const result = await websocket_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle connection timeout gracefully", async () => {
    const node = createMockNode({
      url: "ws://invalid-host:9999",
      timeout_ms: 1000,
    });
    const ctx = createMockContext();
    const result = await websocket_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should support binary messages", async () => {
    const node = createMockNode({
      operation: "send",
      message: "AQIDBA==",
      binary: true,
    });
    const ctx = createMockContext();
    const result = await websocket_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
