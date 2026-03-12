import { describe, it, expect, vi } from "vitest";
import { analyzer_handler } from "../../../src/agent/nodes/analyzer.js";
import type { AnalyzerNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";
import type { RunnerContext } from "../../../src/agent/node-registry.js";

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

  it("execute: mode=sentiment → SentimentTool 위임 (L39-48)", async () => {
    const node = createMockNode({ mode: "sentiment", input_field: "I love this product!", sentiment_action: "analyze" } as any);
    const ctx = createMockContext();
    const result = await analyzer_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("analysis");
    expect(result.output).toHaveProperty("category");
    expect(result.output).toHaveProperty("confidence");
  });

  it("runner_execute: mode=sentiment → execute() 위임 (L72)", async () => {
    const node = createMockNode({ mode: "sentiment", input_field: "neutral text" } as any);
    const ctx = createMockContext();
    const runner = { services: { invoke_llm: null } };
    const result = await analyzer_handler.runner_execute!(node, ctx, runner as any);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("category");
  });
});

// ── from analyzer-extended.test.ts ──

function make_node(overrides?: Partial<AnalyzerNodeDefinition>): OrcheNodeDefinition {
  return {
    node_id: "n1",
    node_type: "analyzer",
    backend: "openrouter",
    prompt_template: "Analyze: {{input}}",
    input_field: "input",
    categories: ["positive", "negative"],
    model: "gpt-4",
    ...overrides,
  } as OrcheNodeDefinition;
}

function make_ctx_ext(memory: Record<string, unknown> = {}): OrcheNodeExecutorContext {
  return { memory, workspace: "/tmp", abort_signal: undefined };
}

function make_runner(invoke_llm?: RunnerContext["services"]["invoke_llm"]): RunnerContext {
  return {
    services: { invoke_llm },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as RunnerContext["logger"],
  } as RunnerContext;
}

describe("analyzer_handler — runner_execute: invoke_llm 없음", () => {
  it("invoke_llm 미설정 → execute() 폴백", async () => {
    const runner = make_runner(undefined);
    const result = await analyzer_handler.runner_execute!(make_node(), make_ctx_ext(), runner);
    expect(result.output).toBeDefined();
    expect(result.output.analysis).toBeDefined();
  });
});

describe("analyzer_handler — runner_execute: invoke_llm 성공", () => {
  it("LLM 응답 → 파싱된 분석 결과 반환", async () => {
    const invoke = vi.fn().mockResolvedValue({
      content: '{"category":"positive","confidence":0.9,"analysis":{"sentiment":"good"}}',
      parsed: { category: "positive", confidence: 0.9, analysis: { sentiment: "good" } },
    });
    const runner = make_runner(invoke);
    const result = await analyzer_handler.runner_execute!(make_node(), make_ctx_ext(), runner);
    expect(result.output.category).toBe("positive");
    expect(result.output.confidence).toBe(0.9);
    expect(result.output.raw_output).toContain("positive");
  });

  it("LLM parsed=null → 기본값 사용", async () => {
    const invoke = vi.fn().mockResolvedValue({
      content: "invalid json response",
      parsed: null,
    });
    const runner = make_runner(invoke);
    const result = await analyzer_handler.runner_execute!(make_node(), make_ctx_ext(), runner);
    expect(result.output.category).toBe("positive"); // n.categories[0]
    expect(result.output.confidence).toBe(0);
    expect(result.output.analysis).toEqual({});
  });

  it("LLM categories 없음 → 'unknown' 카테고리", async () => {
    const invoke = vi.fn().mockResolvedValue({ content: "...", parsed: null });
    const runner = make_runner(invoke);
    const node = make_node({ categories: undefined });
    const result = await analyzer_handler.runner_execute!(node, make_ctx_ext(), runner);
    expect(result.output.category).toBe("unknown");
  });

  it("카테고리 목록 포함 프롬프트 구성", async () => {
    const invoke = vi.fn().mockResolvedValue({ content: "...", parsed: {} });
    const runner = make_runner(invoke);
    const node = make_node({ categories: ["A", "B"] });
    await analyzer_handler.runner_execute!(node, make_ctx_ext(), runner);
    const called_with = invoke.mock.calls[0][0];
    expect(called_with.prompt).toContain("A, B");
  });

  it("output_json_schema 없으면 기본 스키마 사용", async () => {
    const invoke = vi.fn().mockResolvedValue({ content: "...", parsed: {} });
    const runner = make_runner(invoke);
    const node = make_node({ output_json_schema: undefined });
    await analyzer_handler.runner_execute!(node, make_ctx_ext(), runner);
    const called_with = invoke.mock.calls[0][0];
    expect(called_with.output_json_schema).toHaveProperty("type", "object");
  });

  it("output_json_schema 있으면 전달됨", async () => {
    const custom_schema = { type: "object", properties: { result: { type: "string" } } };
    const invoke = vi.fn().mockResolvedValue({ content: "...", parsed: { result: "ok" } });
    const runner = make_runner(invoke);
    const node = make_node({ output_json_schema: custom_schema });
    await analyzer_handler.runner_execute!(node, make_ctx_ext(), runner);
    const called_with = invoke.mock.calls[0][0];
    expect(called_with.output_json_schema).toEqual(custom_schema);
  });
});

describe("analyzer_handler — runner_execute: invoke_llm 오류", () => {
  it("LLM 예외 → error 카테고리 + error 필드 반환", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("LLM timeout"));
    const runner = make_runner(invoke);
    const result = await analyzer_handler.runner_execute!(make_node(), make_ctx_ext(), runner);
    expect(result.output.category).toBe("error");
    expect(String(result.output.error)).toContain("LLM timeout");
    expect(runner.logger.warn).toHaveBeenCalled();
  });
});

describe("analyzer_handler — test() 경고", () => {
  it("prompt_template 없음 → 경고", () => {
    const r = analyzer_handler.test!(make_node({ prompt_template: "" }));
    expect(r.warnings?.some((w) => w.includes("prompt_template"))).toBe(true);
  });

  it("input_field 없음 → 경고", () => {
    const r = analyzer_handler.test!(make_node({ input_field: "" }));
    expect(r.warnings?.some((w) => w.includes("input_field"))).toBe(true);
  });

  it("backend 없음 → 경고", () => {
    const r = analyzer_handler.test!(make_node({ backend: "" }));
    expect(r.warnings?.some((w) => w.includes("backend"))).toBe(true);
  });

  it("output_json_schema 유효 → 경고 없음", () => {
    const r = analyzer_handler.test!(make_node({ output_json_schema: { type: "object" } }));
    expect(r.warnings?.some((w) => w.includes("output_json_schema"))).toBe(false);
  });

  it("preview: model 없으면 auto", () => {
    const r = analyzer_handler.test!(make_node({ model: undefined }));
    expect(r.preview?.model).toBe("auto");
  });

  it("preview: categories 없으면 빈 배열", () => {
    const r = analyzer_handler.test!(make_node({ categories: undefined }));
    expect(r.preview?.categories).toEqual([]);
  });

  it("preview: has_schema=false (스키마 없음)", () => {
    const r = analyzer_handler.test!(make_node({ output_json_schema: undefined }));
    expect(r.preview?.has_schema).toBe(false);
  });

  it("output_json_schema 순환 참조 → catch 경고 (L103)", () => {
    const circular: Record<string, unknown> = { type: "object" };
    circular.self = circular;
    const r = analyzer_handler.test!(make_node({ output_json_schema: circular }));
    expect(r.warnings?.some((w: string) => w.includes("output_json_schema"))).toBe(true);
  });
});
