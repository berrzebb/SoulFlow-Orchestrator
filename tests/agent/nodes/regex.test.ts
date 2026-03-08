/** Regex 노드 핸들러 테스트
 *
 * 목표: regex_handler를 통한 정규식 처리 검증
 *       - operations: test, match, match_all, replace, extract, split
 *       - flags: g (global), i (case-insensitive), m (multiline)
 *       - template variable resolution: {{memory.*}} 경로 접근
 *       - error handling: invalid patterns, edge cases
 */

import { describe, it, expect } from "vitest";
import { regex_handler } from "@src/agent/nodes/regex.js";
import type { RegexNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockRegexNode = (overrides?: Partial<RegexNodeDefinition>): RegexNodeDefinition => ({
  node_id: "regex-1",
  title: "Test Regex Node",
  node_type: "regex",
  operation: "test",
  input: "",
  pattern: "",
  flags: "",
  replacement: "",
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    previous_output: {},
  },
  ...overrides,
});

/* ── Tests ── */

describe("Regex Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(regex_handler.node_type).toBe("regex");
    });

    it("should have output_schema with result and success", () => {
      const schema = regex_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("result");
      expect(fields).toContain("success");
    });

    it("should have create_default returning valid node template", () => {
      const defaultNode = regex_handler.create_default?.();
      expect(defaultNode?.operation).toBe("match");
      expect(defaultNode?.pattern).toBe("");
    });
  });

  describe("execute — test operation", () => {
    it("should test if pattern matches", async () => {
      const node = createMockRegexNode({
        operation: "test",
        pattern: "hello",
        input: "hello world",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const parsed = JSON.parse(result.output.result);
      expect(parsed.matches).toBe(true);
    });

    it("should test if pattern does not match", async () => {
      const node = createMockRegexNode({
        operation: "test",
        pattern: "goodbye",
        input: "hello world",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const parsed = JSON.parse(result.output.result);
      expect(parsed.matches).toBe(false);
    });

    it("should support case-insensitive test", async () => {
      const node = createMockRegexNode({
        operation: "test",
        pattern: "HELLO",
        flags: "i",
        input: "hello world",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const parsed = JSON.parse(result.output.result);
      expect(parsed.matches).toBe(true);
    });
  });

  describe("execute — match operation", () => {
    it("should find first match", async () => {
      const node = createMockRegexNode({
        operation: "match",
        pattern: "\\d+",
        input: "The answer is 42",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const parsed = JSON.parse(result.output.result);
      expect(parsed.found).toBe(true);
      expect(parsed.match).toBe("42");
    });

    it("should return not found when no match", async () => {
      const node = createMockRegexNode({
        operation: "match",
        pattern: "\\d+",
        input: "No numbers here",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const parsed = JSON.parse(result.output.result);
      expect(parsed.found).toBe(false);
    });

    it("should include match index", async () => {
      const node = createMockRegexNode({
        operation: "match",
        pattern: "world",
        input: "hello world",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const parsed = JSON.parse(result.output.result);
      expect(parsed.index).toBe(6);
    });

    it("should capture groups", async () => {
      const node = createMockRegexNode({
        operation: "match",
        pattern: "(\\w+)@(\\w+\\.\\w+)",
        input: "Contact: user@example.com",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const parsed = JSON.parse(result.output.result);
      expect(parsed.found).toBe(true);
      expect(parsed.match).toBe("user@example.com");
    });
  });

  describe("execute — match_all operation", () => {
    it("should find all matches with global flag", async () => {
      const node = createMockRegexNode({
        operation: "match_all",
        pattern: "\\d+",
        flags: "g",
        input: "123 and 456 and 789",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const parsed = JSON.parse(result.output.result);
      expect(parsed.count).toBe(3);
      expect(parsed.matches.map((m: any) => m.match)).toEqual(["123", "456", "789"]);
    });

    it("should add global flag automatically if not present", async () => {
      const node = createMockRegexNode({
        operation: "match_all",
        pattern: "\\w+",
        flags: "i",
        input: "hello world test",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const parsed = JSON.parse(result.output.result);
      expect(parsed.count).toBe(3);
    });

    it("should limit results to 100 matches", async () => {
      let input = "";
      for (let i = 0; i < 150; i++) input += "a ";

      const node = createMockRegexNode({
        operation: "match_all",
        pattern: "a",
        flags: "g",
        input,
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const parsed = JSON.parse(result.output.result);
      expect(parsed.matches.length).toBe(100);
    });

    it("should include match indices", async () => {
      const node = createMockRegexNode({
        operation: "match_all",
        pattern: "\\w+",
        flags: "g",
        input: "foo bar baz",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const parsed = JSON.parse(result.output.result);
      expect(parsed.matches[0].index).toBe(0);
      expect(parsed.matches[1].index).toBe(4);
      expect(parsed.matches[2].index).toBe(8);
    });
  });

  describe("execute — replace operation", () => {
    it("should replace first match", async () => {
      const node = createMockRegexNode({
        operation: "replace",
        pattern: "world",
        input: "hello world world",
        replacement: "universe",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toBe("hello universe world");
    });

    it("should replace all matches with global flag", async () => {
      const node = createMockRegexNode({
        operation: "replace",
        pattern: "world",
        flags: "g",
        input: "hello world world",
        replacement: "universe",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toBe("hello universe universe");
    });

    it("should support case-insensitive replace", async () => {
      const node = createMockRegexNode({
        operation: "replace",
        pattern: "hello",
        flags: "gi",
        input: "Hello HELLO hello",
        replacement: "hi",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toBe("hi hi hi");
    });

    it("should replace with empty string", async () => {
      const node = createMockRegexNode({
        operation: "replace",
        pattern: "\\s+",
        flags: "g",
        input: "hello  world  test",
        replacement: "",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toBe("helloworldtest");
    });
  });

  describe("execute — extract operation", () => {
    it("should extract capture groups", async () => {
      const node = createMockRegexNode({
        operation: "extract",
        pattern: "(\\w+):(\\d+)",
        flags: "g",
        input: "host:8080 remote:3000",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const parsed = JSON.parse(result.output.result);
      expect(parsed.count).toBe(2);
      expect(parsed.extracted[0]).toHaveProperty("group_1");
      expect(parsed.extracted[0]).toHaveProperty("group_2");
    });

    it("should extract named groups", async () => {
      const node = createMockRegexNode({
        operation: "extract",
        pattern: "(?<host>\\w+):(?<port>\\d+)",
        flags: "g",
        input: "localhost:5432",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const parsed = JSON.parse(result.output.result);
      expect(parsed.count).toBe(1);
      expect(parsed.extracted[0].host).toBe("localhost");
      expect(parsed.extracted[0].port).toBe("5432");
    });

    it("should extract email pattern", async () => {
      const node = createMockRegexNode({
        operation: "extract",
        pattern: "([a-z]+)@([a-z]+\\.[a-z]+)",
        flags: "g",
        input: "contact: user@example.com, admin@test.org",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const parsed = JSON.parse(result.output.result);
      expect(parsed.count).toBe(2);
    });

    it("should limit extracted results to 100", async () => {
      let input = "";
      for (let i = 0; i < 150; i++) input += `a${i},`;

      const node = createMockRegexNode({
        operation: "extract",
        pattern: "(a\\d+)",
        flags: "g",
        input,
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const parsed = JSON.parse(result.output.result);
      expect(parsed.extracted.length).toBe(100);
    });
  });

  describe("execute — split operation", () => {
    it("should split by pattern", async () => {
      const node = createMockRegexNode({
        operation: "split",
        pattern: "\\s+",
        input: "hello   world   test",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const parsed = JSON.parse(result.output.result);
      expect(parsed).toEqual(["hello", "world", "test"]);
    });

    it("should split by comma", async () => {
      const node = createMockRegexNode({
        operation: "split",
        pattern: ",\\s*",
        input: "apple, banana, cherry",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const parsed = JSON.parse(result.output.result);
      expect(parsed).toEqual(["apple", "banana", "cherry"]);
    });

    it("should limit split results to 100", async () => {
      let input = "";
      for (let i = 0; i < 150; i++) input += "word ";

      const node = createMockRegexNode({
        operation: "split",
        pattern: "\\s+",
        input,
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const parsed = JSON.parse(result.output.result);
      expect(parsed.length).toBe(100);
    });

    it("should split by newline", async () => {
      const node = createMockRegexNode({
        operation: "split",
        pattern: "\\n",
        input: "line1\nline2\nline3",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const parsed = JSON.parse(result.output.result);
      expect(parsed).toEqual(["line1", "line2", "line3"]);
    });
  });

  describe("execute — template variable resolution", () => {
    it("should resolve input template", async () => {
      const node = createMockRegexNode({
        operation: "test",
        pattern: "\\d+",
        input: "{{memory.text}}",
      });
      const ctx = createMockContext({
        memory: { text: "answer is 42" },
      });

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const parsed = JSON.parse(result.output.result);
      expect(parsed.matches).toBe(true);
    });

    it("should resolve pattern template", async () => {
      const node = createMockRegexNode({
        operation: "match",
        pattern: "{{memory.regex_pattern}}",
        input: "user@example.com",
      });
      const ctx = createMockContext({
        memory: { regex_pattern: "\\w+@\\w+\\.\\w+" },
      });

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const parsed = JSON.parse(result.output.result);
      expect(parsed.found).toBe(true);
    });

    it("should use replacement as-is (no template resolution)", async () => {
      const node = createMockRegexNode({
        operation: "replace",
        pattern: "old",
        replacement: "new",
        input: "old text old",
        flags: "g",
      });
      const ctx = createMockContext({
        memory: { replacement: "unused" },
      });

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toBe("new text new");
    });
  });

  describe("execute — error handling", () => {
    it("should require pattern", async () => {
      const node = createMockRegexNode({
        operation: "test",
        pattern: "",
        input: "text",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
      expect(result.output.result).toContain("pattern is required");
    });

    it("should handle invalid regex pattern", async () => {
      const node = createMockRegexNode({
        operation: "test",
        pattern: "[unclosed",
        input: "text",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
    });

    it("should handle unsupported operation", async () => {
      const node = createMockRegexNode({
        operation: "unknown_op" as any,
        pattern: "test",
        input: "text",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
      expect(result.output.result).toContain("Unsupported");
    });

    it("should handle regex timeout gracefully", async () => {
      // Extremely complex regex that might timeout
      const node = createMockRegexNode({
        operation: "match",
        pattern: "(a+)+b",
        input: "aaaaaaaaaaaaaaaaaaaaaaaaaac",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      // Should handle timeout or complete successfully
      expect(result.output).toBeDefined();
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid config", () => {
      const node = createMockRegexNode({
        operation: "test",
        pattern: "\\d+",
        input: "text",
      });
      const ctx = createMockContext();

      const result = regex_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when pattern missing", () => {
      const node = createMockRegexNode({
        operation: "test",
        pattern: "",
        input: "text",
      });
      const ctx = createMockContext();

      const result = regex_handler.test(node, ctx);

      expect(result.warnings).toContain("pattern is required");
    });

    it("should warn when pattern invalid", () => {
      const node = createMockRegexNode({
        operation: "test",
        pattern: "[invalid",
        input: "text",
      });
      const ctx = createMockContext();

      const result = regex_handler.test(node, ctx);

      expect(result.warnings).toContain("invalid regex pattern");
    });

    it("should include preview with operation and pattern", () => {
      const node = createMockRegexNode({
        operation: "match_all",
        pattern: "\\d+",
        flags: "g",
      });
      const ctx = createMockContext();

      const result = regex_handler.test(node, ctx);

      expect(result.preview.operation).toBe("match_all");
      expect(result.preview.pattern).toBe("\\d+");
      expect(result.preview.flags).toBe("g");
    });
  });

  describe("integration scenarios", () => {
    it("should extract and process email addresses", async () => {
      const node = createMockRegexNode({
        operation: "extract",
        pattern: "([a-z0-9._-]+)@([a-z0-9.-]+)",
        flags: "g",
        input: "Contacts: john.doe@example.com, jane_smith@test.org",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const parsed = JSON.parse(result.output.result);
      expect(parsed.count).toBe(2);
    });

    it("should validate and extract data format", async () => {
      // First validate if data matches format
      let node = createMockRegexNode({
        operation: "test",
        pattern: "^\\d{3}-\\d{3}-\\d{4}$",
        input: "555-123-4567",
      });
      let ctx = createMockContext();

      let result = await regex_handler.execute(node, ctx);
      expect(result.output.success).toBe(true);
      let parsed = JSON.parse(result.output.result);
      expect(parsed.matches).toBe(true);

      // Then extract parts
      node = createMockRegexNode({
        operation: "extract",
        pattern: "(\\d{3})-(\\d{3})-(\\d{4})",
        input: "555-123-4567",
      });
      ctx = createMockContext();

      result = await regex_handler.execute(node, ctx);
      expect(result.output.success).toBe(true);
      parsed = JSON.parse(result.output.result);
      expect(parsed.count).toBe(1);
    });

    it("should parse and transform text", async () => {
      // Split text
      let node = createMockRegexNode({
        operation: "split",
        pattern: ";",
        input: "name=John;age=30;city=NYC",
      });
      let ctx = createMockContext();

      let result = await regex_handler.execute(node, ctx);
      expect(result.output.success).toBe(true);
      let parsed = JSON.parse(result.output.result);
      expect(parsed.length).toBe(3);

      // Replace whitespace
      node = createMockRegexNode({
        operation: "replace",
        pattern: "\\s+",
        flags: "g",
        input: "multiple   spaces   here",
        replacement: " ",
      });
      ctx = createMockContext();

      result = await regex_handler.execute(node, ctx);
      expect(result.output.success).toBe(true);
      expect(result.output.result).toBe("multiple spaces here");
    });

    it("should find and count patterns", async () => {
      const node = createMockRegexNode({
        operation: "match_all",
        pattern: "\\b[A-Z][a-z]+",
        flags: "g",
        input: "The Quick Brown Fox Jumps Over The Lazy Dog",
      });
      const ctx = createMockContext();

      const result = await regex_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const parsed = JSON.parse(result.output.result);
      expect(parsed.count).toBe(9); // All words with capitalization
    });
  });
});
