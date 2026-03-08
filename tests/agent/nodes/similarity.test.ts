import { describe, it, expect } from "vitest";
import { similarity_handler } from "../../../src/agent/nodes/similarity.js";
import type { SimilarityNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("similarity_handler", () => {
  const createMockNode = (overrides?: Partial<SimilarityNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "similarity",
    action: "cosine",
    a: "hello",
    b: "hallo",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be similarity", () => {
    expect(similarity_handler.node_type).toBe("similarity");
  });

  it("metadata: output_schema should have score and result", () => {
    expect(similarity_handler.output_schema).toEqual([
      { name: "score", type: "number", description: "Similarity score" },
      { name: "result", type: "unknown", description: "Full result" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = similarity_handler.create_default?.();
    expect(defaults).toEqual({ action: "cosine", a: "", b: "" });
  });

  it("execute: should handle cosine action", async () => {
    const node = createMockNode({ action: "cosine", a: "text1", b: "text2" });
    const ctx = createMockContext();
    const result = await similarity_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("score");
    expect(result.output).toHaveProperty("result");
  });

  it("execute: should resolve templates in a", async () => {
    const node = createMockNode({ action: "jaccard", a: "${str1}", b: "test" });
    const ctx = createMockContext({ str1: "string1" });
    const result = await similarity_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test validation: should warn if a is missing", () => {
    const node = createMockNode({ a: undefined });
    const result = similarity_handler.test(node);
    expect(result.warnings).toContain("a is required");
  });

  it("test validation: should warn if b is missing", () => {
    const node = createMockNode({ b: undefined });
    const result = similarity_handler.test(node);
    expect(result.warnings).toContain("b is required");
  });

  it("test: preview should contain action", () => {
    const node = createMockNode({ action: "levenshtein" });
    const result = similarity_handler.test(node);
    expect(result.preview).toEqual({ action: "levenshtein" });
  });

  it("execute: should handle levenshtein action", async () => {
    const node = createMockNode({ action: "levenshtein" });
    const ctx = createMockContext();
    const result = await similarity_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
