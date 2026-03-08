import { describe, it, expect } from "vitest";
import { redis_handler } from "../../../src/agent/nodes/redis.js";
import type { RedisNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("redis_handler", () => {
  const createMockNode = (overrides?: Partial<RedisNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "redis",
    action: "get",
    host: "localhost",
    port: 6379,
    key: "test_key",
    value: "test_value",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be redis", () => {
    expect(redis_handler.node_type).toBe("redis");
  });

  it("execute: should handle get action", async () => {
    const node = createMockNode({ action: "get" });
    const ctx = createMockContext();
    const result = await redis_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates", async () => {
    const node = createMockNode({ key: "${redis_key}" });
    const ctx = createMockContext({ redis_key: "user_123" });
    const result = await redis_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle set action", async () => {
    const node = createMockNode({ action: "set", key: "mykey", value: "myvalue" });
    const ctx = createMockContext();
    const result = await redis_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should have action", () => {
    const node = createMockNode({ action: "delete" });
    const result = redis_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle delete action", async () => {
    const node = createMockNode({ action: "delete" });
    const ctx = createMockContext();
    const result = await redis_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ host: "" });
    const ctx = createMockContext();
    const result = await redis_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
