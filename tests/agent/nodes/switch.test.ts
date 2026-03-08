/** Switch 노드 핸들러 테스트
 *
 * 목표: switch_handler를 통한 N-way 분기 검증
 *       - expression 평가 및 케이스 매칭
 *       - branch 출력 (matched case 또는 default)
 *       - memory 변수 접근
 *       - 표현식 오류 처리
 */

import { describe, it, expect } from "vitest";
import { switch_handler } from "@src/agent/nodes/switch.js";
import type { SwitchNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockSwitchNode = (overrides?: Partial<SwitchNodeDefinition>): SwitchNodeDefinition => ({
  node_id: "switch-1",
  title: "Test Switch Node",
  node_type: "switch",
  expression: "value",
  cases: [],
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

describe("Switch Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(switch_handler.node_type).toBe("switch");
    });

    it("should have output_schema with matched_case", () => {
      const schema = switch_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("matched_case");
    });

    it("should have create_default returning valid node template", () => {
      const defaultNode = switch_handler.create_default?.();
      expect(defaultNode?.expression).toBe("value");
      expect(defaultNode?.cases).toHaveLength(1);
    });
  });

  describe("execute — basic matching", () => {
    it("should match exact case", async () => {
      const node = createMockSwitchNode({
        expression: "'red'",
        cases: [
          { value: "red", targets: [] },
          { value: "green", targets: [] },
          { value: "blue", targets: [] },
        ],
      });
      const ctx = createMockContext();

      const result = await switch_handler.execute(node, ctx);

      expect(result.output.matched_case).toBe("red");
      expect(result.branch).toBe("red");
    });

    it("should return default when no match", async () => {
      const node = createMockSwitchNode({
        expression: "'yellow'",
        cases: [
          { value: "red", targets: [] },
          { value: "green", targets: [] },
        ],
      });
      const ctx = createMockContext();

      const result = await switch_handler.execute(node, ctx);

      expect(result.output.matched_case).toBe("default");
      expect(result.branch).toBe("default");
    });

    it("should match numeric values", async () => {
      const node = createMockSwitchNode({
        expression: "42",
        cases: [
          { value: "42", targets: [] },
          { value: "100", targets: [] },
        ],
      });
      const ctx = createMockContext();

      const result = await switch_handler.execute(node, ctx);

      expect(result.output.matched_case).toBe("42");
    });
  });

  describe("execute — memory variable expression", () => {
    it("should evaluate memory variables", async () => {
      const node = createMockSwitchNode({
        expression: "memory.status",
        cases: [
          { value: "active", targets: [] },
          { value: "inactive", targets: [] },
        ],
      });
      const ctx = createMockContext({
        memory: { status: "active" },
      });

      const result = await switch_handler.execute(node, ctx);

      expect(result.output.matched_case).toBe("active");
    });

    it("should handle nested memory access", async () => {
      const node = createMockSwitchNode({
        expression: "memory.user.role",
        cases: [
          { value: "admin", targets: [] },
          { value: "user", targets: [] },
        ],
      });
      const ctx = createMockContext({
        memory: { user: { role: "admin" } },
      });

      const result = await switch_handler.execute(node, ctx);

      expect(result.output.matched_case).toBe("admin");
    });
  });

  describe("execute — complex expressions", () => {
    it("should evaluate conditional expressions", async () => {
      const node = createMockSwitchNode({
        expression: "memory.age >= 18 ? 'adult' : 'minor'",
        cases: [
          { value: "adult", targets: [] },
          { value: "minor", targets: [] },
        ],
      });
      const ctx = createMockContext({
        memory: { age: 25 },
      });

      const result = await switch_handler.execute(node, ctx);

      expect(result.output.matched_case).toBe("adult");
    });

    it("should evaluate mathematical expressions", async () => {
      const node = createMockSwitchNode({
        expression: "String(memory.value % 2)",
        cases: [
          { value: "0", targets: [] },
          { value: "1", targets: [] },
        ],
      });
      const ctx = createMockContext({
        memory: { value: 5 },
      });

      const result = await switch_handler.execute(node, ctx);

      expect(result.output.matched_case).toBe("1");
    });

    it("should convert result to string", async () => {
      const node = createMockSwitchNode({
        expression: "memory.count > 5",
        cases: [
          { value: "true", targets: [] },
          { value: "false", targets: [] },
        ],
      });
      const ctx = createMockContext({
        memory: { count: 10 },
      });

      const result = await switch_handler.execute(node, ctx);

      expect(result.output.matched_case).toBe("true");
    });
  });

  describe("execute — edge cases", () => {
    it("should handle empty cases array", async () => {
      const node = createMockSwitchNode({
        expression: "'anything'",
        cases: [],
      });
      const ctx = createMockContext();

      const result = await switch_handler.execute(node, ctx);

      expect(result.output.matched_case).toBe("default");
    });

    it("should handle first matching case", async () => {
      const node = createMockSwitchNode({
        expression: "'a'",
        cases: [
          { value: "a", targets: [] },
          { value: "a", targets: [] }, // duplicate
        ],
      });
      const ctx = createMockContext();

      const result = await switch_handler.execute(node, ctx);

      expect(result.output.matched_case).toBe("a");
    });

    it("should handle numeric strings", async () => {
      const node = createMockSwitchNode({
        expression: "'123'",
        cases: [
          { value: "123", targets: [] },
        ],
      });
      const ctx = createMockContext();

      const result = await switch_handler.execute(node, ctx);

      expect(result.output.matched_case).toBe("123");
    });

    it("should handle null result", async () => {
      const node = createMockSwitchNode({
        expression: "null",
        cases: [
          { value: "null", targets: [] },
        ],
      });
      const ctx = createMockContext();

      const result = await switch_handler.execute(node, ctx);

      expect(result.output.matched_case).toBe("null");
    });
  });

  describe("execute — error handling", () => {
    it("should throw on expression syntax error", async () => {
      const node = createMockSwitchNode({
        expression: "memory.value >", // Incomplete
        cases: [{ value: "a", targets: [] }],
      });
      const ctx = createMockContext();

      await expect(switch_handler.execute(node, ctx)).rejects.toThrow("switch expression evaluation failed");
    });

    it("should throw on timeout", async () => {
      const node = createMockSwitchNode({
        expression: "while(true) {}",
        cases: [{ value: "a", targets: [] }],
      });
      const ctx = createMockContext();

      await expect(switch_handler.execute(node, ctx)).rejects.toThrow("switch expression evaluation failed");
    });

    it("should handle undefined memory variables", async () => {
      const node = createMockSwitchNode({
        expression: "String(memory.nonexistent)",
        cases: [
          { value: "undefined", targets: [] },
        ],
      });
      const ctx = createMockContext();

      const result = await switch_handler.execute(node, ctx);

      expect(result.output.matched_case).toBe("undefined");
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid expression", () => {
      const node = createMockSwitchNode({
        expression: "memory.status",
        cases: [{ value: "active", targets: [] }],
      });
      const ctx = createMockContext({
        memory: { status: "active" },
      });

      const result = switch_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when expression is empty", () => {
      const node = createMockSwitchNode({
        expression: "",
        cases: [],
      });
      const ctx = createMockContext();

      const result = switch_handler.test(node, ctx);

      expect(result.warnings).toContain("expression is empty");
    });

    it("should warn on expression error", () => {
      const node = createMockSwitchNode({
        expression: "memory.value >",
        cases: [],
      });
      const ctx = createMockContext();

      const result = switch_handler.test(node, ctx);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("expression error");
    });

    it("should include preview with expression and would_match", () => {
      const node = createMockSwitchNode({
        expression: "'test'",
        cases: [
          { value: "test", targets: [] },
          { value: "other", targets: [] },
        ],
      });
      const ctx = createMockContext();

      const result = switch_handler.test(node, ctx);

      expect(result.preview.expression).toBe("'test'");
      expect(result.preview.would_match).toBe("test");
      expect(result.preview.cases).toBe(2);
    });
  });

  describe("integration scenarios", () => {
    it("should route based on status", async () => {
      const node = createMockSwitchNode({
        expression: "memory.order.status",
        cases: [
          { value: "pending", targets: ["send_confirmation"] },
          { value: "confirmed", targets: ["prepare_shipment"] },
          { value: "shipped", targets: ["send_tracking"] },
        ],
      });
      const ctx = createMockContext({
        memory: { order: { status: "confirmed" } },
      });

      const result = await switch_handler.execute(node, ctx);

      expect(result.output.matched_case).toBe("confirmed");
      expect(result.branch).toBe("confirmed");
    });

    it("should route based on user role", async () => {
      const node = createMockSwitchNode({
        expression: "memory.user.role",
        cases: [
          { value: "admin", targets: ["admin_panel"] },
          { value: "moderator", targets: ["mod_panel"] },
          { value: "user", targets: ["user_panel"] },
        ],
      });
      const ctx = createMockContext({
        memory: { user: { role: "moderator" } },
      });

      const result = await switch_handler.execute(node, ctx);

      expect(result.output.matched_case).toBe("moderator");
    });

    it("should handle fallback to default", async () => {
      const node = createMockSwitchNode({
        expression: "memory.action",
        cases: [
          { value: "create", targets: ["create_handler"] },
          { value: "update", targets: ["update_handler"] },
          { value: "delete", targets: ["delete_handler"] },
        ],
      });
      const ctx = createMockContext({
        memory: { action: "unknown" },
      });

      const result = await switch_handler.execute(node, ctx);

      expect(result.output.matched_case).toBe("default");
      expect(result.branch).toBe("default");
    });

    it("should switch based on priority level", async () => {
      const node = createMockSwitchNode({
        expression: "memory.priority > 8 ? 'high' : (memory.priority > 5 ? 'medium' : 'low')",
        cases: [
          { value: "high", targets: ["urgent_queue"] },
          { value: "medium", targets: ["normal_queue"] },
          { value: "low", targets: ["background_queue"] },
        ],
      });
      const ctx = createMockContext({
        memory: { priority: 3 },
      });

      const result = await switch_handler.execute(node, ctx);

      expect(result.output.matched_case).toBe("low");
    });
  });
});
