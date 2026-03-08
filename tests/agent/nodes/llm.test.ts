/** LLM 노드 핸들러 테스트
 *
 * 목표: llm_handler를 통한 LLM 호출 검증
 *       - execute: 스텁 구현 (메타데이터 반환)
 *       - runner_execute: invoke_llm 서비스 호출
 *       - prompt_template: 템플릿 해석
 *       - system_prompt: 시스템 프롬프트 옵션
 *       - backend/model/temperature/max_tokens 설정
 *       - output_json_schema: JSON 파싱
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { llm_handler } from "@src/agent/nodes/llm.js";
import type { LlmNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext, RunnerContext } from "@src/agent/node-registry.js";

/* ── Mock Dependencies ── */

vi.mock("@src/agent/orche-node-executor.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@src/agent/orche-node-executor.js")>();
  return {
    ...actual,
  };
});

import { resolve_templates } from "@src/agent/orche-node-executor.js";

/* ── Mock Data ── */

const createMockLlmNode = (overrides?: Partial<LlmNodeDefinition>): LlmNodeDefinition => ({
  node_id: "llm-1",
  label: "Test LLM",
  node_type: "llm",
  backend: "openrouter",
  model: "gpt-3.5-turbo",
  prompt_template: "What is {{memory.question}}?",
  system_prompt: "You are a helpful assistant.",
  temperature: 0.7,
  max_tokens: 1000,
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    previous_output: {},
    question: "the meaning of life",
    topic: "philosophy",
  },
  ...overrides,
});

const createMockRunner = (overrides?: Partial<RunnerContext>): RunnerContext => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  ...overrides,
});

/* ── Tests ── */

describe("LLM Node Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(llm_handler.node_type).toBe("llm");
    });

    it("should have output_schema with response, parsed, usage", () => {
      const schema = llm_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("response");
      expect(fields).toContain("parsed");
      expect(fields).toContain("usage");
    });

    it("should have input_schema with prompt and context", () => {
      const schema = llm_handler.input_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("prompt");
      expect(fields).toContain("context");
    });

    it("should have create_default returning openrouter backend", () => {
      const defaultNode = llm_handler.create_default?.();
      expect(defaultNode?.backend).toBe("openrouter");
      expect(defaultNode?.prompt_template).toBe("{{prompt}}");
    });

    it("should have icon and color metadata", () => {
      expect(llm_handler.icon).toBeDefined();
      expect(llm_handler.color).toBeDefined();
      expect(llm_handler.shape).toBe("rect");
    });
  });

  describe("execute — stub implementation", () => {
    it("should return empty response with metadata", async () => {
      const node = createMockLlmNode();
      const ctx = createMockContext();

      const result = await llm_handler.execute(node, ctx);

      expect(result.output.response).toBe("");
      expect(result.output.parsed).toBeNull();
      expect(result.output.usage).toEqual({});
    });

    it("should include resolved prompt in _meta", async () => {
      const node = createMockLlmNode({
        prompt_template: "What is {{memory.question}}?",
      });
      const ctx = createMockContext();

      const result = await llm_handler.execute(node, ctx);

      expect((result.output as any)._meta).toBeDefined();
      expect((result.output as any)._meta.prompt).toBe("What is the meaning of life?");
    });

    it("should include resolved system_prompt in _meta", async () => {
      const node = createMockLlmNode({
        system_prompt: "You are an expert in {{memory.topic}}.",
      });
      const ctx = createMockContext();

      const result = await llm_handler.execute(node, ctx);

      expect((result.output as any)._meta.system_prompt).toBe("You are an expert in philosophy.");
    });

    it("should include configuration in _meta", async () => {
      const node = createMockLlmNode({
        backend: "anthropic",
        model: "claude-3-opus",
        temperature: 0.5,
        max_tokens: 2000,
      });
      const ctx = createMockContext();

      const result = await llm_handler.execute(node, ctx);

      const meta = (result.output as any)._meta;
      expect(meta.backend).toBe("anthropic");
      expect(meta.model).toBe("claude-3-opus");
      expect(meta.temperature).toBe(0.5);
      expect(meta.max_tokens).toBe(2000);
    });

    it("should handle undefined system_prompt", async () => {
      const node = createMockLlmNode({ system_prompt: undefined as any });
      const ctx = createMockContext();

      const result = await llm_handler.execute(node, ctx);

      expect((result.output as any)._meta.system_prompt).toBeUndefined();
    });

    it("should handle empty prompt_template", async () => {
      const node = createMockLlmNode({ prompt_template: "" });
      const ctx = createMockContext();

      const result = await llm_handler.execute(node, ctx);

      expect((result.output as any)._meta.prompt).toBe("");
    });
  });

  describe("runner_execute — LLM service integration", () => {
    it("should call invoke_llm service with resolved prompt", async () => {
      const invokeLlm = vi.fn().mockResolvedValue({
        content: "42 is the answer to everything.",
        parsed: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const node = createMockLlmNode({
        prompt_template: "What is {{memory.question}}?",
      });
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { invoke_llm: invokeLlm } });

      const result = await llm_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(invokeLlm).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "What is the meaning of life?",
        })
      );
      expect(result.output.response).toBe("42 is the answer to everything.");
    });

    it("should call invoke_llm with backend, model, temperature", async () => {
      const invokeLlm = vi.fn().mockResolvedValue({
        content: "Response",
        parsed: null,
        usage: {},
      });

      const node = createMockLlmNode({
        backend: "anthropic",
        model: "claude-3-sonnet",
        temperature: 0.2,
      });
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { invoke_llm: invokeLlm } });

      await llm_handler.runner_execute?.(node, ctx, runner);

      expect(invokeLlm).toHaveBeenCalledWith(
        expect.objectContaining({
          provider_id: "anthropic",
          model: "claude-3-sonnet",
          temperature: 0.2,
        })
      );
    });

    it("should call invoke_llm with resolved system prompt", async () => {
      const invokeLlm = vi.fn().mockResolvedValue({
        content: "Response",
        parsed: null,
        usage: {},
      });

      const node = createMockLlmNode({
        system_prompt: "You are expert in {{memory.topic}}.",
      });
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { invoke_llm: invokeLlm } });

      await llm_handler.runner_execute?.(node, ctx, runner);

      expect(invokeLlm).toHaveBeenCalledWith(
        expect.objectContaining({
          system: "You are expert in philosophy.",
        })
      );
    });

    it("should pass output_json_schema to invoke_llm", async () => {
      const invokeLlm = vi.fn().mockResolvedValue({
        content: "Response",
        parsed: null,
        usage: {},
      });

      const schema = { type: "object", properties: { name: { type: "string" } } };
      const node = createMockLlmNode({ output_json_schema: schema as any });
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { invoke_llm: invokeLlm } });

      await llm_handler.runner_execute?.(node, ctx, runner);

      expect(invokeLlm).toHaveBeenCalledWith(expect.objectContaining({
        output_json_schema: schema,
      }));
    });

    it("should pass max_tokens to invoke_llm", async () => {
      const invokeLlm = vi.fn().mockResolvedValue({
        content: "Response",
        parsed: null,
        usage: {},
      });

      const node = createMockLlmNode({ max_tokens: 4096 });
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { invoke_llm: invokeLlm } });

      await llm_handler.runner_execute?.(node, ctx, runner);

      expect(invokeLlm).toHaveBeenCalledWith(expect.objectContaining({
        max_tokens: 4096,
      }));
    });

    it("should pass abort_signal to invoke_llm", async () => {
      const invokeLlm = vi.fn().mockResolvedValue({
        content: "Response",
        parsed: null,
        usage: {},
      });

      const abortSignal = new AbortController().signal;
      const node = createMockLlmNode();
      const ctx = createMockContext({ abort_signal: abortSignal });
      const runner = createMockRunner({ services: { invoke_llm: invokeLlm } });

      await llm_handler.runner_execute?.(node, ctx, runner);

      expect(invokeLlm).toHaveBeenCalledWith(expect.objectContaining({
        abort_signal: abortSignal,
      }));
    });

    it("should return parsed JSON when available", async () => {
      const invokeLlm = vi.fn().mockResolvedValue({
        content: '{"name": "Alice", "age": 30}',
        parsed: { name: "Alice", age: 30 },
        usage: { input_tokens: 20, output_tokens: 15 },
      });

      const node = createMockLlmNode();
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { invoke_llm: invokeLlm } });

      const result = await llm_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(result.output.parsed).toEqual({ name: "Alice", age: 30 });
      expect(result.output.usage).toEqual({ input_tokens: 20, output_tokens: 15 });
    });

    it("should fallback to execute when invoke_llm service unavailable", async () => {
      const node = createMockLlmNode();
      const ctx = createMockContext();
      const runner = createMockRunner({ services: {} });

      const result = await llm_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(result.output.response).toBe("");
      expect(result.output.parsed).toBeNull();
    });

    it("should handle invoke_llm errors gracefully", async () => {
      const invokeLlm = vi.fn().mockRejectedValue(new Error("API rate limit exceeded"));

      const node = createMockLlmNode();
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { invoke_llm: invokeLlm } });

      const result = await llm_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect((result.output as any).error).toContain("API rate limit exceeded");
      expect(result.output.response).toBe("");
      expect(runner.logger.warn).toHaveBeenCalledWith("llm_node_error", expect.any(Object));
    });

    it("should handle undefined parsed gracefully", async () => {
      const invokeLlm = vi.fn().mockResolvedValue({
        content: "Response without JSON",
        parsed: undefined,
        usage: {},
      });

      const node = createMockLlmNode();
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { invoke_llm: invokeLlm } });

      const result = await llm_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(result.output.parsed).toBeNull();
    });

    it("should handle undefined usage gracefully", async () => {
      const invokeLlm = vi.fn().mockResolvedValue({
        content: "Response",
        parsed: null,
        usage: undefined,
      });

      const node = createMockLlmNode();
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { invoke_llm: invokeLlm } });

      const result = await llm_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(result.output.usage).toEqual({});
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid prompt_template", () => {
      const node = createMockLlmNode({ prompt_template: "{{memory.question}}" });
      const ctx = createMockContext();

      const result = llm_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when prompt_template is empty", () => {
      const node = createMockLlmNode({ prompt_template: "" });
      const ctx = createMockContext();

      const result = llm_handler.test(node, ctx);

      expect(result.warnings).toContain("prompt_template is empty");
    });

    it("should warn when prompt_template is whitespace only", () => {
      const node = createMockLlmNode({ prompt_template: "   \n\t   " });
      const ctx = createMockContext();

      const result = llm_handler.test(node, ctx);

      expect(result.warnings).toContain("prompt_template is empty");
    });

    it("should include preview with backend, model, prompt_template", () => {
      const node = createMockLlmNode({
        backend: "anthropic",
        model: "claude-3-opus",
        prompt_template: "Explain {{memory.topic}}",
      });
      const ctx = createMockContext();

      const result = llm_handler.test(node, ctx);

      expect(result.preview.backend).toBe("anthropic");
      expect(result.preview.model).toBe("claude-3-opus");
      expect(result.preview.prompt_template).toBe("Explain {{memory.topic}}");
    });

    it("should not validate system_prompt presence", () => {
      const node = createMockLlmNode({ system_prompt: undefined as any });
      const ctx = createMockContext();

      const result = llm_handler.test(node, ctx);

      // system_prompt is optional
      expect(result.warnings.filter(w => w.includes("system")).length).toBe(0);
    });
  });

  describe("template resolution", () => {
    it("should resolve simple memory variables in prompt", async () => {
      const node = createMockLlmNode({
        prompt_template: "Tell me about {{memory.question}}",
      });
      const ctx = createMockContext({ memory: { question: "AI" } });

      const result = await llm_handler.execute(node, ctx);

      expect((result.output as any)._meta.prompt).toBe("Tell me about AI");
    });

    it("should resolve nested paths in prompt", async () => {
      const node = createMockLlmNode({
        prompt_template: "The {{memory.user.name}} asked: {{memory.user.question}}",
      });
      const ctx = createMockContext({
        memory: { user: { name: "Alice", question: "How does AI work?" } },
      });

      const result = await llm_handler.execute(node, ctx);

      expect((result.output as any)._meta.prompt).toContain("Alice");
      expect((result.output as any)._meta.prompt).toContain("How does AI work?");
    });

    it("should resolve multiple variables in system_prompt", async () => {
      const node = createMockLlmNode({
        system_prompt: "You are {{memory.role}} helping {{memory.user}}.",
      });
      const ctx = createMockContext({
        memory: { role: "an expert", user: "students" },
      });

      const result = await llm_handler.execute(node, ctx);

      expect((result.output as any)._meta.system_prompt).toBe("You are an expert helping students.");
    });

    it("should handle undefined variables in template", async () => {
      const node = createMockLlmNode({
        prompt_template: "What is {{memory.undefined}}?",
      });
      const ctx = createMockContext();

      const result = await llm_handler.execute(node, ctx);

      // Should handle gracefully
      expect((result.output as any)._meta.prompt).toBeDefined();
    });
  });

  describe("backend and model variations", () => {
    it("should support openrouter backend", () => {
      const node = createMockLlmNode({ backend: "openrouter" });
      const ctx = createMockContext();

      const result = llm_handler.test(node, ctx);

      expect(result.preview.backend).toBe("openrouter");
    });

    it("should support anthropic backend", () => {
      const node = createMockLlmNode({ backend: "anthropic" });
      const ctx = createMockContext();

      const result = llm_handler.test(node, ctx);

      expect(result.preview.backend).toBe("anthropic");
    });

    it("should support various model names", () => {
      const models = ["gpt-4", "gpt-3.5-turbo", "claude-3-opus", "claude-3-sonnet", "llama-2"];

      for (const model of models) {
        const node = createMockLlmNode({ model });
        const result = llm_handler.test(node, createMockContext());
        expect(result.preview.model).toBe(model);
      }
    });

    it("should support temperature range", async () => {
      const temperatures = [0, 0.3, 0.7, 1.0, 2.0];

      for (const temp of temperatures) {
        const node = createMockLlmNode({ temperature: temp });
        const ctx = createMockContext();

        const result = await llm_handler.execute(node, ctx);
        expect((result.output as any)._meta.temperature).toBe(temp);
      }
    });

    it("should support various max_tokens values", async () => {
      const tokens = [1, 100, 1000, 4096, 32000];

      for (const token of tokens) {
        const node = createMockLlmNode({ max_tokens: token });
        const ctx = createMockContext();

        const result = await llm_handler.execute(node, ctx);
        expect((result.output as any)._meta.max_tokens).toBe(token);
      }
    });
  });

  describe("integration scenarios", () => {
    it("should process Q&A with template variables", async () => {
      const invokeLlm = vi.fn().mockResolvedValue({
        content: "The meaning of life is a philosophical question often associated with 42.",
        parsed: null,
        usage: { input_tokens: 15, output_tokens: 25 },
      });

      const node = createMockLlmNode({
        backend: "openrouter",
        model: "gpt-3.5-turbo",
        prompt_template: "Answer: {{memory.question}}",
        system_prompt: "You are a knowledgeable assistant.",
      });
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { invoke_llm: invokeLlm } });

      const result = await llm_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(result.output.response).toContain("meaning of life");
      expect(result.output.usage?.input_tokens).toBe(15);
    });

    it("should handle JSON output schema", async () => {
      const invokeLlm = vi.fn().mockResolvedValue({
        content: '{"fact": "The Earth is round", "confidence": 0.99}',
        parsed: { fact: "The Earth is round", confidence: 0.99 },
        usage: {},
      });

      const schema = {
        type: "object",
        properties: {
          fact: { type: "string" },
          confidence: { type: "number" },
        },
      };

      const node = createMockLlmNode({
        output_json_schema: schema as any,
      });
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { invoke_llm: invokeLlm } });

      const result = await llm_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(result.output.parsed?.fact).toBe("The Earth is round");
      expect(result.output.parsed?.confidence).toBe(0.99);
    });

    it("should support system role customization", async () => {
      const invokeLlm = vi.fn().mockResolvedValue({
        content: "def hello(): return 'world'",
        parsed: null,
        usage: {},
      });

      const node = createMockLlmNode({
        system_prompt: "You are an expert Python developer. Respond only with code.",
        prompt_template: "Write a function that says hello",
      });
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { invoke_llm: invokeLlm } });

      await llm_handler.runner_execute?.(node, ctx, runner);

      expect(invokeLlm).toHaveBeenCalledWith(
        expect.objectContaining({
          system: "You are an expert Python developer. Respond only with code.",
        })
      );
    });
  });

  describe("edge cases", () => {
    it("should handle very long prompt_template", () => {
      const longTemplate = "Explain: " + "Lorem ipsum dolor sit amet. ".repeat(100);
      const node = createMockLlmNode({ prompt_template: longTemplate });
      const ctx = createMockContext();

      const result = llm_handler.test(node, ctx);

      expect(result.preview.prompt_template).toBe(longTemplate);
      expect(result.warnings).toEqual([]);
    });

    it("should handle prompt_template with special characters", async () => {
      const node = createMockLlmNode({
        prompt_template: 'What is "{{memory.question}}"? ({{memory.topic}})',
      });
      const ctx = createMockContext();

      const result = await llm_handler.execute(node, ctx);

      expect((result.output as any)._meta.prompt).toBeDefined();
    });

    it("should handle multiple nested template variables", async () => {
      const node = createMockLlmNode({
        prompt_template: "{{memory.a}} {{memory.b}} {{memory.c}} {{memory.d}}",
      });
      const ctx = createMockContext({
        memory: { a: "1", b: "2", c: "3", d: "4" },
      });

      const result = await llm_handler.execute(node, ctx);

      expect((result.output as any)._meta.prompt).toBe("1 2 3 4");
    });

    it("should handle null backend value gracefully", () => {
      const node = createMockLlmNode({ backend: null as any });
      const ctx = createMockContext();

      const result = llm_handler.test(node, ctx);

      expect(result.preview.backend).toBeNull();
    });

    it("should handle undefined model value", () => {
      const node = createMockLlmNode({ model: undefined as any });
      const ctx = createMockContext();

      const result = llm_handler.test(node, ctx);

      expect(result.preview.model).toBeUndefined();
    });

    it("should handle zero max_tokens", async () => {
      const node = createMockLlmNode({ max_tokens: 0 });
      const ctx = createMockContext();

      const result = await llm_handler.execute(node, ctx);

      expect((result.output as any)._meta.max_tokens).toBe(0);
    });

    it("should handle negative temperature", async () => {
      const node = createMockLlmNode({ temperature: -1 });
      const ctx = createMockContext();

      const result = await llm_handler.execute(node, ctx);

      expect((result.output as any)._meta.temperature).toBe(-1);
    });
  });

  describe("error scenarios", () => {
    it("should log warning and return error on service failure", async () => {
      const invokeLlm = vi.fn().mockRejectedValue(new Error("Connection timeout"));

      const node = createMockLlmNode({ node_id: "llm-error-test" });
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { invoke_llm: invokeLlm } });

      const result = await llm_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect((result.output as any).error).toContain("Connection timeout");
      expect(runner.logger.warn).toHaveBeenCalledWith(
        "llm_node_error",
        expect.objectContaining({
          node_id: "llm-error-test",
          error: expect.any(String),
        })
      );
    });

    it("should return empty response on unknown service error", async () => {
      const invokeLlm = vi.fn().mockRejectedValue("Unknown error");

      const node = createMockLlmNode();
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { invoke_llm: invokeLlm } });

      const result = await llm_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(result.output.response).toBe("");
      expect((result.output as any).error).toBeDefined();
    });
  });
});
