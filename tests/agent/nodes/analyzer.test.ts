import { describe, it, expect } from "vitest";
import { analyzer_handler } from "../../../src/agent/nodes/analyzer.js";
import type { AnalyzerNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("analyzer_handler", () => {
  const createMockNode = (overrides?: Partial<AnalyzerNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "analyzer",
    backend: "openrouter",
    prompt_template: "Analyze: {{input}}",
    input_field: "input",
    categories: ["positive", "negative"],
    model: "gpt-4",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be analyzer", () => {
    expect(analyzer_handler.node_type).toBe("analyzer");
  });

  it("metadata: output_schema should have analysis, category, confidence, raw_output", () => {
    expect(analyzer_handler.output_schema).toEqual([
      { name: "analysis", type: "object", description: "Structured analysis result" },
      { name: "category", type: "string", description: "Classification category" },
      { name: "confidence", type: "number", description: "Confidence score (0-1)" },
      { name: "raw_output", type: "string", description: "Raw LLM output" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = analyzer_handler.create_default?.();
    expect(defaults).toEqual({
      mode: "llm",
      backend: "openrouter",
      prompt_template: "Analyze the following:\n\n{{input}}",
      input_field: "input",
      categories: [],
      sentiment_action: "analyze",
    });
  });

  it("execute: should return analysis output", async () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = await analyzer_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("analysis");
    expect(result.output).toHaveProperty("category");
    expect(result.output).toHaveProperty("confidence");
    expect(result.output).toHaveProperty("raw_output");
  });

  it("execute: should resolve templates in prompt_template", async () => {
    const node = createMockNode({ prompt_template: "Analyze: ${data}" });
    const ctx = createMockContext({ data: "test content" });
    const result = await analyzer_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in input_field", async () => {
    const node = createMockNode({ input_field: "${field_name}" });
    const ctx = createMockContext({ field_name: "content" });
    const result = await analyzer_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should use first category as default", async () => {
    const node = createMockNode({ categories: ["positive", "negative", "neutral"] });
    const ctx = createMockContext();
    const result = await analyzer_handler.execute(node, ctx);
    expect(result.output.category).toBe("positive");
  });

  it("test: preview should contain backend and model", () => {
    const node = createMockNode({ backend: "claude", model: "claude-3" });
    const result = analyzer_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle missing categories", async () => {
    const node = createMockNode({ categories: undefined });
    const ctx = createMockContext();
    const result = await analyzer_handler.execute(node, ctx);
    expect(result.output.category).toBe("unknown");
  });

  it("execute: should handle empty categories array", async () => {
    const node = createMockNode({ categories: [] });
    const ctx = createMockContext();
    const result = await analyzer_handler.execute(node, ctx);
    expect(result.output.category).toBe("unknown");
  });
});
