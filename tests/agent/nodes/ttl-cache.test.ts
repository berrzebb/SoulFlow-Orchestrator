import { describe, it, expect } from "vitest";
import { ttl_cache_handler } from "../../../src/agent/nodes/ttl-cache.js";
import type { TtlCacheNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("ttl_cache_handler", () => {
  const createMockNode = (overrides?: Partial<TtlCacheNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "ttl_cache",
    operation: "set",
    key: "cache-key",
    value: "cached-value",
    ttl_ms: 60000,
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be ttl-cache", () => {
    expect(ttl_cache_handler.node_type).toBe("ttl_cache");
  });

  it("execute: should set cache value", async () => {
    const node = createMockNode({ operation: "set" });
    const ctx = createMockContext();
    const result = await ttl_cache_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in key", async () => {
    const node = createMockNode({ key: "${cache_key}" });
    const ctx = createMockContext({ cache_key: "user-123" });
    const result = await ttl_cache_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should get cached value", async () => {
    const node = createMockNode({ operation: "get", key: "test-key" });
    const ctx = createMockContext();
    const result = await ttl_cache_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should delete cache entry", async () => {
    const node = createMockNode({
      operation: "delete",
      key: "expired-key",
    });
    const ctx = createMockContext();
    const result = await ttl_cache_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show operation and TTL", () => {
    const node = createMockNode();
    const result = ttl_cache_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should clear all cache", async () => {
    const node = createMockNode({ operation: "clear" });
    const ctx = createMockContext();
    const result = await ttl_cache_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should check cache existence", async () => {
    const node = createMockNode({
      operation: "exists",
      key: "some-key",
    });
    const ctx = createMockContext();
    const result = await ttl_cache_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should extend TTL on existing entry", async () => {
    const node = createMockNode({
      operation: "extend",
      key: "active-key",
      ttl_ms: 120000,
    });
    const ctx = createMockContext();
    const result = await ttl_cache_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});

describe("ttl-cache — test() key 없음 경고 (L50)", () => {
  const mk = (overrides: Partial<TtlCacheNodeDefinition>): OrcheNodeDefinition =>
    ({ node_id: "n1", node_type: "ttl_cache", operation: "set", key: "k", ttl_ms: 60000, ...overrides } as OrcheNodeDefinition);

  it("operation=set + key 빈 문자열 → key 경고 (L50)", () => {
    const result = ttl_cache_handler.test(mk({ operation: "set", key: "" }));
    expect(result.warnings.some((w: string) => w.includes("key"))).toBe(true);
  });

  it("operation=get + key undefined → key 경고 (L50)", () => {
    const result = ttl_cache_handler.test(mk({ operation: "get", key: undefined }));
    expect(result.warnings.some((w: string) => w.includes("key"))).toBe(true);
  });
});
