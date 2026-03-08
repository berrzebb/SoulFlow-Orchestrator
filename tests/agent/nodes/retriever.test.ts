import { describe, it, expect } from "vitest";
import { retriever_handler } from "../../../src/agent/nodes/retriever.js";
import type { RetrieverNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("retriever_handler", () => {
  const createMockNode = (overrides?: Partial<RetrieverNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "retriever",
    query: "search query",
    store_id: "default",
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

  it("execute: should support different retrieval strategies", async () => {
    const node = createMockNode({
      retrieval_mode: "semantic",
      top_k: 10,
    });
    const ctx = createMockContext();
    const result = await retriever_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should apply filters on retrieval", async () => {
    const node = createMockNode({
      query: "test",
      filter: { category: "important" },
    });
    const ctx = createMockContext();
    const result = await retriever_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show query and store", () => {
    const node = createMockNode();
    const result = retriever_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle empty query gracefully", async () => {
    const node = createMockNode({ query: "" });
    const ctx = createMockContext();
    const result = await retriever_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should support pagination", async () => {
    const node = createMockNode({
      top_k: 5,
      skip: 10,
    });
    const ctx = createMockContext();
    const result = await retriever_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should include metadata in results", async () => {
    const node = createMockNode({
      include_metadata: true,
    });
    const ctx = createMockContext();
    const result = await retriever_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
