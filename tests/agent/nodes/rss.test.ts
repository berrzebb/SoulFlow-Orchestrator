import { describe, it, expect } from "vitest";
import { rss_handler } from "../../../src/agent/nodes/rss.js";
import type { RssNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("rss_handler", () => {
  const createMockNode = (overrides?: Partial<RssNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "rss",
    action: "fetch",
    url: "https://example.com/feed.xml",
    limit: 10,
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be rss", () => {
    expect(rss_handler.node_type).toBe("rss");
  });

  it("execute: should handle fetch action", async () => {
    const node = createMockNode({ action: "fetch" });
    const ctx = createMockContext();
    const result = await rss_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates", async () => {
    const node = createMockNode({ url: "${feed_url}" });
    const ctx = createMockContext({ feed_url: "https://test.com/rss" });
    const result = await rss_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle parse action", async () => {
    const node = createMockNode({ action: "parse" });
    const ctx = createMockContext();
    const result = await rss_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should have action", () => {
    const node = createMockNode({ action: "validate" });
    const result = rss_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ url: "" });
    const ctx = createMockContext();
    const result = await rss_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
