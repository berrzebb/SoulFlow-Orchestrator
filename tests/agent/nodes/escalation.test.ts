/** Escalation 노드 핸들러 테스트
 *
 * 목표: escalation_handler를 통한 에스컬레이션 검증
 *       - always/on_timeout/on_rejection/custom 조건
 *       - 메시지 템플릿 해석
 *       - 타겟 채널 및 chat_id 설정
 *       - 우선순위 레벨
 */

import { describe, it, expect, vi } from "vitest";
import { escalation_handler } from "@src/agent/nodes/escalation.js";
import type { EscalationNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";

const createMockEscalationNode = (overrides?: Partial<EscalationNodeDefinition>): EscalationNodeDefinition => ({
  node_id: "escalation-1",
  label: "Test Escalation",
  node_type: "escalation",
  condition: "always",
  message: "Escalation triggered",
  target_channel: "alerts",
  target_chat_id: "chat123",
  priority: "high",
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
    workspace_id: "workspace-1",
  },
  ...overrides,
});

describe("Escalation Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(escalation_handler.node_type).toBe("escalation");
    });

    it("should have output_schema with escalated and escalated_to", () => {
      const schema = escalation_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("escalated");
      expect(fields).toContain("escalated_to");
      expect(fields).toContain("escalated_at");
      expect(fields).toContain("reason");
    });

    it("should have create_default with always condition", () => {
      const defaultNode = escalation_handler.create_default?.();
      expect(defaultNode?.condition).toBe("always");
      expect(defaultNode?.priority).toBe("high");
    });
  });

  describe("execute", () => {
    it("should return not escalated state", async () => {
      const node = createMockEscalationNode();
      const ctx = createMockContext();

      const result = await escalation_handler.execute(node, ctx);

      expect(result.output.escalated).toBe(false);
      expect(result.output.escalated_to).toBeNull();
      expect(result.output.reason).toBe("");
      expect(result.output.escalated_at).toBeDefined();
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid config", () => {
      const node = createMockEscalationNode({
        condition: "always",
        message: "Alert message",
        target_channel: "alerts",
      });
      const ctx = createMockContext();

      const result = escalation_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when message is missing", () => {
      const node = createMockEscalationNode({
        message: "",
      });
      const ctx = createMockContext();

      const result = escalation_handler.test(node, ctx);

      expect(result.warnings).toContain("message is required");
    });

    it("should warn when target_channel is missing", () => {
      const node = createMockEscalationNode({
        target_channel: "",
      });
      const ctx = createMockContext();

      const result = escalation_handler.test(node, ctx);

      expect(result.warnings).toContain("target_channel is required");
    });

    it("should include preview with condition and target", () => {
      const node = createMockEscalationNode({
        condition: "on_timeout",
        priority: "critical",
        target_channel: "critical-alerts",
        message: "Service timeout detected",
      });
      const ctx = createMockContext();

      const result = escalation_handler.test(node, ctx);

      expect(result.preview.condition).toBe("on_timeout");
      expect(result.preview.priority).toBe("critical");
      expect(result.preview.target_channel).toBe("critical-alerts");
    });

    it("should truncate long messages in preview", () => {
      const longMessage = "A".repeat(200);
      const node = createMockEscalationNode({
        message: longMessage,
      });
      const ctx = createMockContext();

      const result = escalation_handler.test(node, ctx);

      expect(result.preview.message.length).toBeLessThanOrEqual(100);
    });
  });

  describe("template resolution", () => {
    it("should resolve template in message", () => {
      const node = createMockEscalationNode({
        message: "Escalation for {{memory.workspace_id}}",
      });
      const ctx = createMockContext();

      const result = escalation_handler.test(node, ctx);

      expect(result.preview.message).toContain("workspace-1");
    });

    it("should handle missing template variables", () => {
      const node = createMockEscalationNode({
        message: "Error in {{memory.missing_var}}",
      });
      const ctx = createMockContext();

      const result = escalation_handler.test(node, ctx);

      expect(result.preview.message).toBeDefined();
    });
  });

  describe("priority levels", () => {
    it("should support low priority", () => {
      const node = createMockEscalationNode({
        priority: "low",
      });
      const ctx = createMockContext();

      const result = escalation_handler.test(node, ctx);

      expect(result.preview.priority).toBe("low");
    });

    it("should support medium priority", () => {
      const node = createMockEscalationNode({
        priority: "medium",
      });
      const ctx = createMockContext();

      const result = escalation_handler.test(node, ctx);

      expect(result.preview.priority).toBe("medium");
    });

    it("should support high priority", () => {
      const node = createMockEscalationNode({
        priority: "high",
      });
      const ctx = createMockContext();

      const result = escalation_handler.test(node, ctx);

      expect(result.preview.priority).toBe("high");
    });

    it("should support critical priority", () => {
      const node = createMockEscalationNode({
        priority: "critical",
      });
      const ctx = createMockContext();

      const result = escalation_handler.test(node, ctx);

      expect(result.preview.priority).toBe("critical");
    });
  });

  describe("condition types", () => {
    it("should recognize always condition", () => {
      const node = createMockEscalationNode({
        condition: "always",
      });
      const ctx = createMockContext();

      const result = escalation_handler.test(node, ctx);

      expect(result.preview.condition).toBe("always");
    });

    it("should recognize on_timeout condition", () => {
      const node = createMockEscalationNode({
        condition: "on_timeout",
        depends_on: ["node-1", "node-2"],
      });
      const ctx = createMockContext();

      const result = escalation_handler.test(node, ctx);

      expect(result.preview.condition).toBe("on_timeout");
    });

    it("should recognize on_rejection condition", () => {
      const node = createMockEscalationNode({
        condition: "on_rejection",
        depends_on: ["approval-node"],
      });
      const ctx = createMockContext();

      const result = escalation_handler.test(node, ctx);

      expect(result.preview.condition).toBe("on_rejection");
    });

    it("should recognize custom condition", () => {
      const node = createMockEscalationNode({
        condition: "custom",
        custom_expression: "memory.error_count > 5",
      });
      const ctx = createMockContext();

      const result = escalation_handler.test(node, ctx);

      expect(result.preview.condition).toBe("custom");
    });
  });

  describe("channel targeting", () => {
    it("should support specific channel", () => {
      const node = createMockEscalationNode({
        target_channel: "incident-channel",
        target_chat_id: "channel-123",
      });
      const ctx = createMockContext();

      const result = escalation_handler.test(node, ctx);

      expect(result.preview.target_channel).toBe("incident-channel");
    });

    it("should support chat_id", () => {
      const node = createMockEscalationNode({
        target_chat_id: "user-456",
      });
      const ctx = createMockContext();

      const result = escalation_handler.test(node, ctx);

      expect(result.preview).toBeDefined();
    });

    it("should handle both channel and chat_id", () => {
      const node = createMockEscalationNode({
        target_channel: "alerts",
        target_chat_id: "admin-user",
      });
      const ctx = createMockContext();

      const result = escalation_handler.test(node, ctx);

      expect(result.preview.target_channel).toBe("alerts");
    });
  });

  describe("edge cases", () => {
    it("should handle empty depends_on array", () => {
      const node = createMockEscalationNode({
        condition: "on_timeout",
        depends_on: [],
      });
      const ctx = createMockContext();

      const result = escalation_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should handle special characters in message", () => {
      const node = createMockEscalationNode({
        message: "Alert: [CRITICAL] !@#$%^&*()",
      });
      const ctx = createMockContext();

      const result = escalation_handler.test(node, ctx);

      expect(result.preview.message).toContain("[CRITICAL]");
    });

    it("should handle very long target_channel", () => {
      const node = createMockEscalationNode({
        target_channel: "channel-with-very-long-name-" + "x".repeat(100),
      });
      const ctx = createMockContext();

      const result = escalation_handler.test(node, ctx);

      expect(result.preview.target_channel).toBeDefined();
    });

    it("should handle undefined priority (defaults to high)", () => {
      const node = createMockEscalationNode() as any;
      delete node.priority;
      const ctx = createMockContext();

      const result = escalation_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should handle missing custom_expression for custom condition", () => {
      const node = createMockEscalationNode({
        condition: "custom",
      }) as any;
      delete node.custom_expression;
      const ctx = createMockContext();

      const result = escalation_handler.test(node, ctx);

      expect(result.preview).toBeDefined();
    });
  });

  describe("timestamp generation", () => {
    it("should include ISO timestamp in output", async () => {
      const node = createMockEscalationNode();
      const ctx = createMockContext();

      const result = await escalation_handler.execute(node, ctx);

      expect(result.output.escalated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});

// ── runner_execute + evaluate_condition 테스트 ────────────────────────────

function make_runner(memory: Record<string, unknown> = {}, send_message?: (r: any) => Promise<void>) {
  return {
    state: { memory },
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() },
    options: { send_message },
  } as any;
}

describe("escalation_handler.runner_execute", () => {
  it("always 조건 + send_message 있음 → escalated=true, send_message 호출", async () => {
    const node = createMockEscalationNode({ condition: "always", message: "Alert!", target_channel: "slack", target_chat_id: "C001" });
    const send_message = vi.fn().mockResolvedValue(undefined);
    const runner = make_runner({}, send_message);
    const ctx = createMockContext();

    const result = await escalation_handler.runner_execute!(node, ctx, runner);

    expect(result.output.escalated).toBe(true);
    expect(result.output.escalated_to).toMatchObject({ channel: "slack", chat_id: "C001" });
    expect(send_message).toHaveBeenCalledOnce();
    const req = send_message.mock.calls[0][0];
    expect(req.content).toContain("[ESCALATION:high]");
    expect(req.content).toContain("Alert!");
  });

  it("always 조건 + send_message 없음 → escalated=false, reason=no_send_callback", async () => {
    const node = createMockEscalationNode({ condition: "always" });
    const runner = make_runner({}, undefined);
    const ctx = createMockContext();

    const result = await escalation_handler.runner_execute!(node, ctx, runner);

    expect(result.output.escalated).toBe(false);
    expect(result.output.reason).toBe("no_send_callback");
    expect(runner.logger.warn).toHaveBeenCalledWith("escalation_no_send_message", expect.any(Object));
  });

  it("on_timeout 조건 → 의존 노드에 timed_out=true 있으면 에스컬레이션", async () => {
    const node = createMockEscalationNode({ condition: "on_timeout", depends_on: ["node-a"] });
    const memory = { "node-a": { timed_out: true } };
    const send_message = vi.fn().mockResolvedValue(undefined);
    const runner = make_runner(memory, send_message);

    const result = await escalation_handler.runner_execute!(node, createMockContext(), runner);
    expect(result.output.escalated).toBe(true);
  });

  it("on_timeout 조건 → timed_out 없으면 에스컬레이션 안 함", async () => {
    const node = createMockEscalationNode({ condition: "on_timeout", depends_on: ["node-a"] });
    const memory = { "node-a": { timed_out: false } };
    const send_message = vi.fn().mockResolvedValue(undefined);
    const runner = make_runner(memory, send_message);

    const result = await escalation_handler.runner_execute!(node, createMockContext(), runner);
    expect(result.output.escalated).toBe(false);
    expect(result.output.reason).toBe("condition_not_met");
  });

  it("on_rejection 조건 → 의존 노드에 approved=false 있으면 에스컬레이션", async () => {
    const node = createMockEscalationNode({ condition: "on_rejection", depends_on: ["approval-1"] });
    const memory = { "approval-1": { approved: false } };
    const send_message = vi.fn().mockResolvedValue(undefined);
    const runner = make_runner(memory, send_message);

    const result = await escalation_handler.runner_execute!(node, createMockContext(), runner);
    expect(result.output.escalated).toBe(true);
  });

  it("on_rejection 조건 → approved=true이면 에스컬레이션 안 함", async () => {
    const node = createMockEscalationNode({ condition: "on_rejection", depends_on: ["approval-1"] });
    const memory = { "approval-1": { approved: true } };
    const send_message = vi.fn().mockResolvedValue(undefined);
    const runner = make_runner(memory, send_message);

    const result = await escalation_handler.runner_execute!(node, createMockContext(), runner);
    expect(result.output.escalated).toBe(false);
  });

  it("custom 조건 → 표현식이 truthy이면 에스컬레이션", async () => {
    const node = createMockEscalationNode({
      condition: "custom",
      custom_expression: "memory.error_count > 3",
    });
    const memory = { error_count: 5 };
    const send_message = vi.fn().mockResolvedValue(undefined);
    const runner = make_runner(memory, send_message);

    const result = await escalation_handler.runner_execute!(node, createMockContext(), runner);
    expect(result.output.escalated).toBe(true);
  });

  it("custom 조건 → 표현식이 falsy이면 에스컬레이션 안 함", async () => {
    const node = createMockEscalationNode({
      condition: "custom",
      custom_expression: "memory.error_count > 10",
    });
    const memory = { error_count: 2 };
    const runner = make_runner(memory);

    const result = await escalation_handler.runner_execute!(node, createMockContext(), runner);
    expect(result.output.escalated).toBe(false);
  });

  it("custom 조건 → 표현식 에러 시 false 반환", async () => {
    const node = createMockEscalationNode({
      condition: "custom",
      custom_expression: "this_will_throw.undefined.access",
    });
    const runner = make_runner({});

    const result = await escalation_handler.runner_execute!(node, createMockContext(), runner);
    expect(result.output.escalated).toBe(false);
  });

  it("custom_expression 없음 → false (에스컬레이션 안 함)", async () => {
    const node = createMockEscalationNode({ condition: "custom" }) as any;
    delete node.custom_expression;
    const runner = make_runner({});

    const result = await escalation_handler.runner_execute!(node, createMockContext(), runner);
    expect(result.output.escalated).toBe(false);
  });

  it("unknown 조건 → false (에스컬레이션 안 함)", async () => {
    const node = createMockEscalationNode({ condition: "unknown_condition" as any });
    const runner = make_runner({});

    const result = await escalation_handler.runner_execute!(node, createMockContext(), runner);
    expect(result.output.escalated).toBe(false);
  });

  it("메시지 템플릿 보간 적용됨", async () => {
    const node = createMockEscalationNode({
      condition: "always",
      message: "User {{memory.user}} reported error",
    });
    const memory = { user: "alice" };
    const send_message = vi.fn().mockResolvedValue(undefined);
    const runner = make_runner(memory, send_message);

    await escalation_handler.runner_execute!(node, createMockContext(), runner);

    const req = send_message.mock.calls[0][0];
    expect(req.content).toContain("alice");
  });
});
