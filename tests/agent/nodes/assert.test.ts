/** Assert 노드 핸들러 테스트
 *
 * 목표: assert_handler를 통한 데이터 검증 검증
 *       - execute: 여러 조건 평가 및 오류 수집
 *       - on_fail: halt (중단) vs 계속 진행
 *       - template variable resolution: {{memory.*}} 조건 내에서 사용
 *       - error handling: 표현식 오류, 타임아웃, 검증 실패
 */

import { describe, it, expect } from "vitest";
import { assert_handler } from "@src/agent/nodes/assert.js";
import type { AssertNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockAssertNode = (overrides?: Partial<AssertNodeDefinition>): AssertNodeDefinition => ({
  node_id: "assert-1",
  title: "Test Assert Node",
  node_type: "assert",
  assertions: [],
  on_fail: "continue" as const, // Default to continue so tests can collect errors
  error_message: "",
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

describe("Assert Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(assert_handler.node_type).toBe("assert");
    });

    it("should have output_schema with valid, errors, checked", () => {
      const schema = assert_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("valid");
      expect(fields).toContain("errors");
      expect(fields).toContain("checked");
    });

    it("should have create_default returning valid node template", () => {
      const defaultNode = assert_handler.create_default?.();
      expect(defaultNode?.assertions).toEqual([]);
      expect(defaultNode?.on_fail).toBe("halt");
    });
  });

  describe("execute — single assertion", () => {
    it("should pass simple true condition", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "true" },
        ],
      });
      const ctx = createMockContext();

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(true);
      expect(result.output.errors).toEqual([]);
      expect(result.output.checked).toBe(1);
    });

    it("should fail simple false condition", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "false" },
        ],
      });
      const ctx = createMockContext();

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(false);
      expect(result.output.errors).toHaveLength(1);
      expect(result.output.checked).toBe(1);
    });

    it("should use custom error message", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "false", message: "Custom error message" },
        ],
      });
      const ctx = createMockContext();

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(false);
      expect(result.output.errors[0]).toBe("Custom error message");
    });

    it("should use default error message", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "1 + 1 === 3" },
        ],
      });
      const ctx = createMockContext();

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(false);
      expect(result.output.errors[0]).toContain("Assertion failed");
      expect(result.output.errors[0]).toContain("1 + 1 === 3");
    });
  });

  describe("execute — multiple assertions", () => {
    it("should evaluate all assertions", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "true" },
          { condition: "1 + 1 === 2" },
          { condition: "'hello'.length === 5" },
        ],
      });
      const ctx = createMockContext();

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(true);
      expect(result.output.errors).toEqual([]);
      expect(result.output.checked).toBe(3);
    });

    it("should collect multiple errors", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "false", message: "Error 1" },
          { condition: "1 + 1 === 3", message: "Error 2" },
          { condition: "true" },
          { condition: "false", message: "Error 3" },
        ],
      });
      const ctx = createMockContext();

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(false);
      expect(result.output.errors).toHaveLength(3);
      expect(result.output.errors).toContain("Error 1");
      expect(result.output.errors).toContain("Error 2");
      expect(result.output.errors).toContain("Error 3");
      expect(result.output.checked).toBe(4);
    });

    it("should stop at first error when on_fail=halt", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "false", message: "First error" },
          { condition: "false", message: "Would not run" },
        ],
        on_fail: "halt",
      });
      const ctx = createMockContext();

      // When on_fail=halt and there are errors, execute throws
      await expect(assert_handler.execute(node, ctx)).rejects.toThrow();
    });

    it("should continue on error when on_fail=continue", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "false", message: "Error 1" },
          { condition: "false", message: "Error 2" },
        ],
        on_fail: "continue",
      });
      const ctx = createMockContext();

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(false);
      expect(result.output.errors).toHaveLength(2);
      expect(result.output.checked).toBe(2);
    });
  });

  describe("execute — memory access in conditions", () => {
    it("should access memory variables", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "memory.value === 42" },
        ],
      });
      const ctx = createMockContext({
        memory: { value: 42 },
      });

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(true);
    });

    it("should access nested memory objects", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "memory.user.age > 18" },
        ],
      });
      const ctx = createMockContext({
        memory: { user: { age: 25, name: "John" } },
      });

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(true);
    });

    it("should access memory arrays", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "memory.items.length === 3" },
          { condition: "memory.items[0] === 'a'" },
        ],
      });
      const ctx = createMockContext({
        memory: { items: ["a", "b", "c"] },
      });

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(true);
    });

    it("should handle missing memory variables", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "memory.nonexistent === undefined" },
        ],
      });
      const ctx = createMockContext();

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(true);
    });

    it("should evaluate string comparisons", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "memory.name === 'Alice'" },
          { condition: "memory.name.length === 5" },
        ],
      });
      const ctx = createMockContext({
        memory: { name: "Alice" },
      });

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(true);
    });
  });

  describe("execute — template variable resolution in messages", () => {
    it("should resolve template in error message", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "false", message: "User {{memory.name}} failed validation" },
        ],
      });
      const ctx = createMockContext({
        memory: { name: "John" },
      });

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(false);
      expect(result.output.errors[0]).toBe("User John failed validation");
    });

    it("should resolve template in error_message field", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "false" },
        ],
        error_message: "Validation failed for {{memory.operation}}",
        on_fail: "halt",
      });
      const ctx = createMockContext({
        memory: { operation: "user_signup" },
      });

      await expect(assert_handler.execute(node, ctx)).rejects.toThrow("Validation failed for user_signup");
    });

    it("should use assertion messages when error_message not provided", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "false", message: "Assertion level error" },
        ],
        error_message: "",
        on_fail: "halt",
      });
      const ctx = createMockContext();

      await expect(assert_handler.execute(node, ctx)).rejects.toThrow("Assertion level error");
    });
  });

  describe("execute — complex conditions", () => {
    it("should evaluate mathematical expressions", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "memory.value > 100" },
          { condition: "memory.value < 200" },
          { condition: "(memory.value - 50) * 2 === 250" },
        ],
      });
      const ctx = createMockContext({
        memory: { value: 175 },
      });

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(true);
    });

    it("should evaluate logical operators", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "memory.active && memory.verified" },
          { condition: "!memory.suspended" },
          { condition: "(memory.role === 'admin') || (memory.role === 'moderator')" },
        ],
      });
      const ctx = createMockContext({
        memory: { active: true, verified: true, suspended: false, role: "admin" },
      });

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(true);
    });

    it("should evaluate string operations", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "memory.email.includes('@')" },
          { condition: "memory.name.startsWith('John')" },
        ],
      });
      const ctx = createMockContext({
        memory: { email: "john@example.com", name: "John Doe" },
      });

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(true);
    });

    it("should evaluate array operations", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "memory.scores.every(s => s >= 0)" },
          { condition: "memory.tags.some(t => t === 'important')" },
        ],
      });
      const ctx = createMockContext({
        memory: { scores: [10, 20, 30], tags: ["archived", "important"] },
      });

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(true);
    });
  });

  describe("execute — error handling", () => {
    it("should catch syntax errors in conditions", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "memory.value >" }, // Incomplete expression
        ],
        on_fail: "continue",
      });
      const ctx = createMockContext();

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(false);
      expect(result.output.errors[0]).toContain("Expression error");
    });

    it("should catch undefined property access gracefully", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "memory.nonexistent.property === undefined" },
        ],
        on_fail: "continue",
      });
      const ctx = createMockContext();

      const result = await assert_handler.execute(node, ctx);

      // Should handle undefined gracefully
      expect(result.output.checked).toBe(1);
    });

    it("should handle infinite loops with timeout", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "while(true) {}" }, // Will timeout
        ],
        on_fail: "continue",
      });
      const ctx = createMockContext();

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(false);
      expect(result.output.errors[0]).toContain("Expression error");
    });

    it("should handle type coercion", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "memory.value == '42'" }, // Loose equality
          { condition: "memory.value === 42" }, // Strict equality
        ],
      });
      const ctx = createMockContext({
        memory: { value: 42 },
      });

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(true);
    });
  });

  describe("execute — on_fail behavior", () => {
    it("should throw error when on_fail=halt and validation fails", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "false", message: "Test failed" },
        ],
        on_fail: "halt",
      });
      const ctx = createMockContext();

      await expect(assert_handler.execute(node, ctx)).rejects.toThrow("Assert failed");
    });

    it("should use custom error_message in halt", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "false" },
        ],
        on_fail: "halt",
        error_message: "Custom validation error",
      });
      const ctx = createMockContext();

      await expect(assert_handler.execute(node, ctx)).rejects.toThrow("Custom validation error");
    });

    it("should not throw error when on_fail=continue", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "false", message: "Validation failed" },
        ],
        on_fail: "continue",
      });
      const ctx = createMockContext();

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(false);
      expect(result.output.errors).toHaveLength(1);
      // Should not throw - function completes normally
    });
  });

  describe("execute — empty assertions", () => {
    it("should handle empty assertions array", async () => {
      const node = createMockAssertNode({
        assertions: [],
      });
      const ctx = createMockContext();

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(true);
      expect(result.output.errors).toEqual([]);
      expect(result.output.checked).toBe(0);
    });

    it("should treat undefined assertions as empty", async () => {
      const node = createMockAssertNode({
        assertions: undefined as any,
      });
      const ctx = createMockContext();

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(true);
      expect(result.output.checked).toBe(0);
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid config", () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "true" },
        ],
      });
      const ctx = createMockContext();

      const result = assert_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when no assertions provided", () => {
      const node = createMockAssertNode({
        assertions: [],
      });
      const ctx = createMockContext();

      const result = assert_handler.test(node, ctx);

      expect(result.warnings).toContain("at least one assertion is required");
    });

    it("should warn when assertion condition is empty", () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "" },
        ],
      });
      const ctx = createMockContext();

      const result = assert_handler.test(node, ctx);

      expect(result.warnings).toContain("assertion condition is empty");
    });

    it("should warn when assertion condition is whitespace", () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "   " },
        ],
      });
      const ctx = createMockContext();

      const result = assert_handler.test(node, ctx);

      expect(result.warnings).toContain("assertion condition is empty");
    });

    it("should include preview with assertion count and on_fail", () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "true" },
          { condition: "false" },
        ],
        on_fail: "continue",
      });
      const ctx = createMockContext();

      const result = assert_handler.test(node, ctx);

      expect(result.preview.assertion_count).toBe(2);
      expect(result.preview.on_fail).toBe("continue");
    });
  });

  describe("integration scenarios", () => {
    it("should validate data before processing", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "memory.user !== null", message: "User object must exist" },
          { condition: "memory.user.email", message: "Email is required" },
          { condition: "memory.user.age >= 18", message: "Must be 18 or older" },
        ],
        on_fail: "halt",
      });
      const ctx = createMockContext({
        memory: { user: { email: "john@example.com", age: 25 } },
      });

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(true);
      expect(result.output.checked).toBe(3);
    });

    it("should validate API response structure", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "memory.response && memory.response.status === 200", message: "Status must be 200" },
          { condition: "memory.response.data && memory.response.data.length > 0", message: "Data array must not be empty" },
          { condition: "memory.response.timestamp", message: "Timestamp is required" },
        ],
      });
      const ctx = createMockContext({
        memory: {
          response: { status: 200, data: [{ id: 1 }], timestamp: new Date().toISOString() },
        },
      });

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(true);
    });

    it("should collect validation errors without halting", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "memory.form.name && memory.form.name.length > 0", message: "Name is required" },
          { condition: "memory.form.email && memory.form.email.includes('@')", message: "Valid email is required" },
          { condition: "memory.form.age >= 18", message: "Age must be 18+" },
        ],
        on_fail: "continue",
      });
      const ctx = createMockContext({
        memory: {
          form: { name: "", email: "invalid", age: 16 },
        },
      });

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(false);
      expect(result.output.errors).toHaveLength(3);
    });

    it("should perform conditional validation", async () => {
      const node = createMockAssertNode({
        assertions: [
          { condition: "memory.payment_method === 'card' ? memory.card_number : true", message: "Card number required for card payments" },
          { condition: "memory.payment_method === 'bank' ? memory.account_number : true", message: "Account number required for bank transfers" },
        ],
      });
      const ctx = createMockContext({
        memory: { payment_method: "card", card_number: "4111111111111111", account_number: null },
      });

      const result = await assert_handler.execute(node, ctx);

      expect(result.output.valid).toBe(true);
    });
  });
});
