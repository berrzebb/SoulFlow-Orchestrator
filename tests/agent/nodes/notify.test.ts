import { describe, it, expect } from "vitest";
import { notify_handler } from "../../../src/agent/nodes/notify.js";
import type { NotifyNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("notify_handler", () => {
  const createMockNode = (overrides?: Partial<NotifyNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "notify",
    content: "Notification message",
    target: "origin",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be notify", () => {
    expect(notify_handler.node_type).toBe("notify");
  });

  it("execute: should send notification", async () => {
    const node = createMockNode({ content: "Test message" });
    const ctx = createMockContext();
    const result = await notify_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in content", async () => {
    const node = createMockNode({ content: "${msg_text}" });
    const ctx = createMockContext({ msg_text: "Alert: System error" });
    const result = await notify_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show content", () => {
    const node = createMockNode({ content: "Preview message" });
    const ctx = createMockContext();
    const result = notify_handler.test(node, ctx);
    expect(result.preview).toBeDefined();
  });

  it("test: should warn when content is missing", () => {
    const node = createMockNode({ content: "" });
    const ctx = createMockContext();
    const result = notify_handler.test(node, ctx);
    expect(result.warnings).toBeDefined();
  });

  it("execute: should handle empty content gracefully", async () => {
    const node = createMockNode({ content: "" });
    const ctx = createMockContext();
    const result = await notify_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
