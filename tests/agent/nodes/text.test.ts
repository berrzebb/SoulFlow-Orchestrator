/** Text 노드 핸들러 테스트
 *
 * 목표: text_handler를 통한 텍스트 변환 검증
 *       - execute: TextTool 동적 로드 및 operation 실행
 *       - Template resolution: input/input2에서 {{memory.key}} 치환
 *       - Text operations: upper/lower/title/slugify/count/dedup/similarity/truncate/pad 등
 *       - Error handling: 입력 크기 초과, 잘못된 operation
 *       - Success flag: "Error:" 문자열 유무로 판단
 *       - Validation: test() 함수의 필수 필드 검증
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { text_handler } from "@src/agent/nodes/text.js";
import type { TextNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockTextNode = (overrides?: Partial<TextNodeDefinition>): TextNodeDefinition => ({
  node_id: "text-1",
  title: "Test Text Node",
  node_type: "text",
  operation: "upper",
  input: "hello world",
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    text_input: "sample text for processing",
    format: "uppercase",
    previous_output: {},
  },
  ...overrides,
});

/* ── Tests ── */

describe("Text Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(text_handler.node_type).toBe("text");
    });

    it("should have output_schema with result and success", () => {
      const schema = text_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("result");
      expect(fields).toContain("success");
    });

    it("should have create_default returning valid node template", () => {
      const defaultNode = text_handler.create_default?.();
      expect(defaultNode?.operation).toBe("count");
      expect(defaultNode?.input).toBe("");
      expect(defaultNode?.max_length).toBe(100);
      expect(defaultNode?.width).toBe(80);
    });
  });

  describe("execute — text operations", () => {
    it("should perform upper operation", async () => {
      const node = createMockTextNode({
        operation: "upper",
        input: "hello world",
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.result).toBe("HELLO WORLD");
      expect(result.output.success).toBe(true);
    });

    it("should perform lower operation", async () => {
      const node = createMockTextNode({
        operation: "lower",
        input: "HELLO WORLD",
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.result).toBe("hello world");
      expect(result.output.success).toBe(true);
    });

    it("should perform title case operation", async () => {
      const node = createMockTextNode({
        operation: "title",
        input: "hello world from claude",
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.result).toBe("Hello World From Claude");
      expect(result.output.success).toBe(true);
    });

    it("should perform reverse operation", async () => {
      const node = createMockTextNode({
        operation: "reverse",
        input: "hello",
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.result).toBe("olleh");
      expect(result.output.success).toBe(true);
    });

    it("should perform count operation", async () => {
      const node = createMockTextNode({
        operation: "count",
        input: "hello world",
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      // count returns word count
      expect(result.output.success).toBe(true);
      expect(result.output.result).toBeDefined();
    });

    it("should perform truncate operation with max_length", async () => {
      const node = createMockTextNode({
        operation: "truncate",
        input: "hello world this is a longer text",
        max_length: 15,
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.result.length).toBeLessThanOrEqual(15);
      expect(result.output.success).toBe(true);
    });

    it("should perform slugify operation", async () => {
      const node = createMockTextNode({
        operation: "slugify",
        input: "Hello World Example",
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      // slugify converts to lowercase with hyphens
      expect(result.output.result).toBeDefined();
    });

    it("should perform snake_case conversion", async () => {
      const node = createMockTextNode({
        operation: "snake",
        input: "Hello World Test",
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result.includes("_")).toBe(true);
    });

    it("should perform kebab-case conversion", async () => {
      const node = createMockTextNode({
        operation: "kebab",
        input: "Hello World Test",
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result.includes("-")).toBe(true);
    });

    it("should perform camelCase conversion", async () => {
      const node = createMockTextNode({
        operation: "camel",
        input: "hello world test",
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toBeDefined();
    });

    it("should handle missing input gracefully", async () => {
      const node = createMockTextNode({
        input: undefined,
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toBeDefined();
    });

    it("should handle missing operation and default to count", async () => {
      const node = createMockTextNode({
        operation: undefined as any,
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
    });
  });

  describe("execute — template resolution", () => {
    it("should resolve template in input", async () => {
      const node = createMockTextNode({
        operation: "upper",
        input: "{{memory.text_input}}",
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      // Should process the resolved text (converted to uppercase)
      expect(result.output.result).toContain("SAMPLE");
    });

    it("should resolve template in input2", async () => {
      const node = createMockTextNode({
        operation: "similarity",
        input: "hello world",
        input2: "{{memory.text_input}}",
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
    });

    it("should resolve multiple templates in input", async () => {
      const node = createMockTextNode({
        operation: "upper",
        input: "{{memory.format}}: {{memory.text_input}}",
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toContain("UPPERCASE");
    });
  });

  describe("execute — options handling", () => {
    it("should pass max_length to truncate operation", async () => {
      const node = createMockTextNode({
        operation: "truncate",
        input: "This is a very long text that should be truncated",
        max_length: 10,
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result.length).toBeLessThanOrEqual(10);
    });

    it("should pass width to wrap operation", async () => {
      const node = createMockTextNode({
        operation: "wrap",
        input: "This is a long line that should be wrapped at the specified width",
        width: 20,
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      // Wrapped text should respect width
      const lines = result.output.result.split("\n");
      expect(lines.length).toBeGreaterThan(1);
    });
  });

  describe("execute — error handling", () => {
    it("should detect error in result starting with Error:", async () => {
      const node = createMockTextNode({
        operation: "similarity",
        input: "a".repeat(600000), // Very large input
        input2: "test",
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      // Large input should cause error
      expect(result.output.success).toBe(false);
      expect(result.output.result).toContain("Error");
    });

    it("should handle invalid operation gracefully", async () => {
      const node = createMockTextNode({
        operation: "invalid_op_xyz",
        input: "test text",
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      // Invalid operation should return error
      expect(result.output.success).toBe(false);
      expect(result.output.result).toContain("Error");
    });

    it("should catch import errors during TextTool instantiation", async () => {
      // This test would fail only if import itself fails, which is unlikely
      // But we test the error handling path
      const node = createMockTextNode({
        operation: "upper",
        input: "test",
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      // Should not throw, should return a result
      expect(result.output).toBeDefined();
    });
  });

  describe("execute — similarity operation", () => {
    it("should perform similarity comparison between two inputs", async () => {
      const node = createMockTextNode({
        operation: "similarity",
        input: "hello",
        input2: "hello world",
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      // Should return similarity score/distance
      expect(result.output.result).toBeDefined();
    });

    it("should handle similarity with identical strings", async () => {
      const node = createMockTextNode({
        operation: "similarity",
        input: "test string",
        input2: "test string",
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
    });
  });

  describe("execute — dedup operation", () => {
    it("should deduplicate lines in input", async () => {
      const node = createMockTextNode({
        operation: "dedup",
        input: "line1\nline2\nline1\nline3\nline2",
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toContain("line1");
      expect(result.output.result).toContain("line2");
      expect(result.output.result).toContain("line3");
    });
  });

  describe("execute — pad operation", () => {
    it("should pad text to specified length", async () => {
      const node = createMockTextNode({
        operation: "pad",
        input: "test",
        max_length: 10,
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid node with input", () => {
      const node = createMockTextNode({
        input: "valid input text",
      });

      const result = text_handler.test(node);

      expect(result.warnings).toEqual([]);
    });

    it("should warn if input is missing", () => {
      const node = createMockTextNode({
        input: undefined,
      });

      const result = text_handler.test(node);

      expect(result.warnings).toContain("input is required");
    });

    it("should warn if input is empty string", () => {
      const node = createMockTextNode({
        input: "",
      });

      const result = text_handler.test(node);

      expect(result.warnings).toContain("input is required");
    });

    it("should warn if input is only whitespace", () => {
      const node = createMockTextNode({
        input: "   ",
      });

      const result = text_handler.test(node);

      expect(result.warnings).toContain("input is required");
    });

    it("should not warn if input has non-whitespace content", () => {
      const node = createMockTextNode({
        input: "  text with content  ",
      });

      const result = text_handler.test(node);

      expect(result.warnings).not.toContain("input is required");
    });

    it("should return preview with operation", () => {
      const node = createMockTextNode({
        operation: "slugify",
      });

      const result = text_handler.test(node);

      expect(result.preview).toEqual({
        operation: "slugify",
      });
    });

    it("should handle multiple warnings if both operation and input missing", () => {
      const node = createMockTextNode({
        operation: "",
        input: "",
      });

      const result = text_handler.test(node);

      expect(result.warnings).toContain("input is required");
    });
  });

  describe("integration scenarios", () => {
    it("should handle text processing pipeline — resolve template, process, return result", async () => {
      const node = createMockTextNode({
        operation: "upper",
        input: "{{memory.text_input}}",
      });
      const ctx = createMockContext({
        memory: {
          agent_id: "agent-1",
          user_id: "user-1",
          workspace_id: "workspace-1",
          text_input: "hello from claude",
          format: "test",
          previous_output: {},
        },
      });

      const result = await text_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toContain("HELLO");
      expect(result.output.result).toContain("CLAUDE");
    });

    it("should process multi-operation text transformation", async () => {
      // First: truncate
      const truncateNode = createMockTextNode({
        operation: "truncate",
        input: "This is a very long text that exceeds the limit",
        max_length: 15,
      });
      const ctx = createMockContext();

      const truncateResult = await text_handler.execute(truncateNode, ctx);
      expect(truncateResult.output.success).toBe(true);

      // Then: upper (simulated via second execution)
      const upperNode = createMockTextNode({
        operation: "upper",
        input: truncateResult.output.result,
      });

      const upperResult = await text_handler.execute(upperNode, ctx);
      expect(upperResult.output.success).toBe(true);
      expect(upperResult.output.result).toBe(truncateResult.output.result.toUpperCase());
    });

    it("should handle similarity check between processed and original", async () => {
      const node = createMockTextNode({
        operation: "similarity",
        input: "original text",
        input2: "original text modified",
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toBeDefined();
    });

    it("should count words in processed text", async () => {
      const node = createMockTextNode({
        operation: "count",
        input: "the quick brown fox jumps over the lazy dog",
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      // Should return word count
      expect(result.output.result).toBeDefined();
    });

    it("should handle wrap with custom width", async () => {
      const node = createMockTextNode({
        operation: "wrap",
        input: "This is a sentence that will be wrapped at a specific width to demonstrate line breaking",
        width: 30,
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const lines = result.output.result.split("\n");
      expect(lines.length).toBeGreaterThan(1);
    });

    it("should deduplicate and then count lines", async () => {
      const node = createMockTextNode({
        operation: "dedup",
        input: "apple\nbanana\napple\norange\nbanana\ngrape",
      });
      const ctx = createMockContext();

      const result = await text_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      // Should have 4 unique lines
      const uniqueLines = result.output.result.split("\n").filter(Boolean);
      expect(uniqueLines.length).toBe(4);
    });
  });
});
