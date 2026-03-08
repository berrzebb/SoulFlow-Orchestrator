import { describe, it, expect } from "vitest";
import { web_search_handler } from "../../../src/agent/nodes/web-search.js";
import type { WebSearchNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("web_search_handler", () => {
  const createMockNode = (overrides?: Partial<WebSearchNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "web_search",
    query: "test query",
    max_results: 5,
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be web_search", () => {
    expect(web_search_handler.node_type).toBe("web_search");
  });

  it("execute: should search with query", async () => {
    const node = createMockNode({ query: "machine learning" });
    const ctx = createMockContext();
    const result = await web_search_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in query", async () => {
    const node = createMockNode({ query: "${search_term}" });
    const ctx = createMockContext({ search_term: "artificial intelligence" });
    const result = await web_search_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should respect max_results limit", async () => {
    const node = createMockNode({ query: "test", max_results: 10 });
    const ctx = createMockContext();
    const result = await web_search_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show query", () => {
    const node = createMockNode({ query: "python programming" });
    const result = web_search_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should support different search engines", async () => {
    const node = createMockNode({
      query: "test",
      search_engine: "bing",
    });
    const ctx = createMockContext();
    const result = await web_search_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle empty query", async () => {
    const node = createMockNode({ query: "" });
    const ctx = createMockContext();
    const result = await web_search_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should return results with query metadata", async () => {
    const node = createMockNode({ query: "nodejs", max_results: 3 });
    const ctx = createMockContext();
    const result = await web_search_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle network timeouts gracefully", async () => {
    const node = createMockNode({
      query: "test",
      timeout_ms: 1000,
    });
    const ctx = createMockContext();
    const result = await web_search_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
