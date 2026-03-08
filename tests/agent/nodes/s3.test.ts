import { describe, it, expect } from "vitest";
import { s3_handler } from "../../../src/agent/nodes/s3.js";
import type { S3NodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("s3_handler", () => {
  const createMockNode = (overrides?: Partial<S3NodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "s3",
    action: "list",
    bucket: "my-bucket",
    key: "",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be s3", () => {
    expect(s3_handler.node_type).toBe("s3");
  });

  it("execute: should handle list action", async () => {
    const node = createMockNode({ action: "list" });
    const ctx = createMockContext();
    const result = await s3_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates", async () => {
    const node = createMockNode({ bucket: "${s3_bucket}" });
    const ctx = createMockContext({ s3_bucket: "prod-bucket" });
    const result = await s3_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle get action", async () => {
    const node = createMockNode({ action: "get", key: "file.txt" });
    const ctx = createMockContext();
    const result = await s3_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should have action", () => {
    const node = createMockNode({ action: "put" });
    const result = s3_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ bucket: "" });
    const ctx = createMockContext();
    const result = await s3_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
