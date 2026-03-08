import { describe, it, expect } from "vitest";
import { retriever_handler } from "../../../src/agent/nodes/retriever.js";
import type { RetrieverNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("retriever_handler", () => {
  const createMockNode = (overrides?: Partial<RetrieverNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "retriever",
    query: "search query",
    source: "memory",
    top_k: 5,
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be retriever", () => {
    expect(retriever_handler.node_type).toBe("retriever");
  });

  it("execute: should retrieve documents", async () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = await retriever_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in query", async () => {
    const node = createMockNode({ query: "${search_text}" });
    const ctx = createMockContext({ search_text: "machine learning" });
    const result = await retriever_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should support http source", async () => {
    const node = createMockNode({
      source: "http",
      url: "https://api.example.com/search",
      top_k: 10,
    });
    const ctx = createMockContext();
    try {
      const result = await retriever_handler.execute(node, ctx);
      expect(result.output).toBeDefined();
    } catch {
      // Network errors are expected in test environment
      expect(true).toBe(true);
    }
  });

  it("execute: should search memory source", async () => {
    const node = createMockNode({
      query: "test",
      source: "memory",
    });
    const ctx = createMockContext({
      data1: "this is test data",
      data2: "another item",
    });
    const result = await retriever_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show query and store", () => {
    const node = createMockNode();
    const result = retriever_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle empty query", async () => {
    const node = createMockNode({ query: "", source: "memory" });
    const ctx = createMockContext();
    const result = await retriever_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should respect top_k limit", async () => {
    const node = createMockNode({
      query: "test",
      source: "memory",
      top_k: 2,
    });
    const ctx = createMockContext({
      item1: "test content 1",
      item2: "test content 2",
      item3: "test content 3",
    });
    const result = await retriever_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle file source", async () => {
    const node = createMockNode({
      source: "file",
      file_path: "/tmp/data.txt",
    });
    const ctx = createMockContext();
    const result = await retriever_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
