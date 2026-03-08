import { describe, it, expect } from "vitest";
import { send_file_handler } from "../../../src/agent/nodes/send-file.js";
import type { OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("send_file_handler", () => {
  const createMockNode = (overrides?: Partial<any>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "send_file",
    file_path: "/tmp/file.txt",
    target: "slack",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be send_file", () => {
    expect(send_file_handler.node_type).toBe("send_file");
  });

  it("execute: should send file", async () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = await send_file_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should be defined with context", () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = send_file_handler.test(node, ctx);
    expect(result.preview).toBeDefined();
  });
});
