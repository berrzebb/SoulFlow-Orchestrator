/** Approval (승인/거절) 노드 핸들러 테스트
 *
 * 목표: approval_handler를 통한 이진 승인 결정 검증
 *       - execute: 빈 결과 반환
 *       - runner_execute: ask_channel 호출로 실제 승인 대기
 *       - message: 승인 요청 메시지 템플릿 해석
 *       - quorum: 다중 승인자 지원
 *       - target: origin 또는 지정 채널
 *       - timeout: 승인 대기 타임아웃
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { approval_handler } from "@src/agent/nodes/approval.js";
import type { ApprovalNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext, RunnerContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockApprovalNode = (overrides?: Partial<ApprovalNodeDefinition>): ApprovalNodeDefinition => ({
  node_id: "approval-1",
  title: "Test Approval Node",
  node_type: "approval",
  message: "Please approve this action",
  target: "origin" as const,
  require_comment: false,
  quorum: 1,
  timeout_ms: 600_000,
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

const createMockRunnerContext = (overrides?: Partial<RunnerContext>): RunnerContext => ({
  state: {
    workflow_id: "wf-1",
    agent_id: "agent-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    memory: {},
  },
  all_nodes: [],
  options: {
    workspace: { id: "workspace-1", api_key: "test-key" },
    abort_signal: undefined,
    ask_channel: vi.fn(),
  },
  execute_node: vi.fn(),
  emit: vi.fn(),
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  ...overrides,
});

/* ── Tests ── */

describe("Approval Node Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(approval_handler.node_type).toBe("approval");
    });

    it("should have output_schema with approval-related fields", () => {
      const schema = approval_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("approved");
      expect(fields).toContain("comment");
      expect(fields).toContain("approved_by");
      expect(fields).toContain("approved_at");
      expect(fields).toContain("votes");
    });

    it("should have create_default returning valid node template", () => {
      const defaultNode = approval_handler.create_default?.();
      expect(defaultNode?.target).toBe("origin");
      expect(defaultNode?.quorum).toBe(1);
      expect(defaultNode?.require_comment).toBe(false);
      expect(defaultNode?.timeout_ms).toBe(600_000);
    });
  });

  describe("execute — basic operation", () => {
    it("should return empty approval result", async () => {
      const node = createMockApprovalNode();
      const ctx = createMockContext();

      const result = await approval_handler.execute(node, ctx);

      expect(result.output.approved).toBe(false);
      expect(result.output.comment).toBe("");
      expect(result.output.approved_by).toBeNull();
      expect(result.output.votes).toEqual([]);
    });

    it("should include timestamp in empty result", async () => {
      const node = createMockApprovalNode();
      const ctx = createMockContext();

      const result = await approval_handler.execute(node, ctx);

      expect(result.output.approved_at).toBeDefined();
      expect(typeof result.output.approved_at).toBe("string");
      // Should be ISO string
      expect(result.output.approved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("runner_execute — ask_channel integration", () => {
    it("should call ask_channel with approval request", async () => {
      const node = createMockApprovalNode({
        message: "Please review this change",
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        state: {
          workflow_id: "wf-1",
          agent_id: "agent-1",
          user_id: "user-1",
          workspace_id: "workspace-1",
          memory: {},
        },
        options: {
          workspace: { id: "workspace-1", api_key: "test-key" },
          ask_channel: vi.fn().mockResolvedValueOnce({
            approved: true,
            comment: "Looks good",
            responded_by: { id: "approver-1", name: "Alice" },
            responded_at: "2024-01-01T12:00:00Z",
          }),
        },
      });

      const result = await approval_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(mockRunner.options.ask_channel).toHaveBeenCalled();
      expect(result.output.approved).toBe(true);
      expect(result.output.comment).toBe("Looks good");
    });

    it("should handle approval rejection", async () => {
      const node = createMockApprovalNode();
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        options: {
          workspace: { id: "workspace-1", api_key: "test-key" },
          ask_channel: vi.fn().mockResolvedValueOnce({
            approved: false,
            comment: "Not ready",
            responded_by: { id: "approver-1", name: "Bob" },
            responded_at: "2024-01-01T12:00:00Z",
          }),
        },
      });

      const result = await approval_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.approved).toBe(false);
      expect(result.output.comment).toBe("Not ready");
    });

    it("should handle null approver response", async () => {
      const node = createMockApprovalNode();
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        options: {
          workspace: { id: "workspace-1", api_key: "test-key" },
          ask_channel: vi.fn().mockResolvedValueOnce({
            approved: false,
            comment: "",
            responded_by: null,
            responded_at: "2024-01-01T12:00:00Z",
          }),
        },
      });

      const result = await approval_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.approved_by).toBeNull();
    });

    it("should include timestamp from ask_channel response", async () => {
      const node = createMockApprovalNode();
      const ctx = createMockContext();
      const timestamp = "2024-01-01T15:30:00Z";
      const mockRunner = createMockRunnerContext({
        options: {
          workspace: { id: "workspace-1", api_key: "test-key" },
          ask_channel: vi.fn().mockResolvedValueOnce({
            approved: true,
            comment: "ok",
            responded_by: { id: "approver-1", name: "Carol" },
            responded_at: timestamp,
          }),
        },
      });

      const result = await approval_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.approved_at).toBe(timestamp);
    });

    it("should emit node_waiting event", async () => {
      const node = createMockApprovalNode();
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        state: { workflow_id: "wf-1" } as any,
        options: {
          workspace: { id: "workspace-1", api_key: "test-key" },
          ask_channel: vi.fn().mockResolvedValueOnce({
            approved: true,
            comment: "",
            responded_by: { id: "approver-1", name: "Dave" },
            responded_at: "2024-01-01T12:00:00Z",
          }),
        },
      });

      await approval_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(mockRunner.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "node_waiting",
          node_id: "approval-1",
          node_type: "approval",
          reason: "waiting_approval",
        })
      );
    });

    it("should handle ask_channel missing gracefully", async () => {
      const node = createMockApprovalNode();
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        options: {
          workspace: { id: "workspace-1", api_key: "test-key" },
          ask_channel: undefined,
        },
      });

      const result = await approval_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.approved).toBe(false);
      expect(mockRunner.logger.warn).toHaveBeenCalledWith(
        "approval_no_ask_channel",
        expect.objectContaining({ node_id: "approval-1" })
      );
    });
  });

  describe("runner_execute — message template resolution", () => {
    it("should resolve template variables in message", async () => {
      const node = createMockApprovalNode({
        message: "Approve deployment to {{memory.env}} environment",
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        state: {
          workflow_id: "wf-1",
          agent_id: "agent-1",
          user_id: "user-1",
          workspace_id: "workspace-1",
          memory: { env: "production" },
        },
        options: {
          workspace: { id: "workspace-1", api_key: "test-key" },
          ask_channel: vi.fn().mockResolvedValueOnce({
            approved: true,
            comment: "",
            responded_by: { id: "approver-1", name: "Eve" },
            responded_at: "2024-01-01T12:00:00Z",
          }),
        },
      });

      await approval_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      const callArgs = (mockRunner.options.ask_channel as any).mock.calls[0];
      expect(callArgs[0].content).toContain("production");
    });

    it("should handle missing template variables as empty", async () => {
      const node = createMockApprovalNode({
        message: "Review {{memory.missing}} change",
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        options: {
          workspace: { id: "workspace-1", api_key: "test-key" },
          ask_channel: vi.fn().mockResolvedValueOnce({
            approved: false,
            comment: "",
            responded_by: null,
            responded_at: "2024-01-01T12:00:00Z",
          }),
        },
      });

      await approval_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect((mockRunner.options.ask_channel as any)).toHaveBeenCalled();
    });
  });

  describe("runner_execute — multi-approver (quorum)", () => {
    it("should support quorum parameter in approval request", async () => {
      const node = createMockApprovalNode({
        quorum: 3,
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        options: {
          workspace: { id: "workspace-1", api_key: "test-key" },
          ask_channel: vi.fn().mockResolvedValueOnce({
            approved: true,
            comment: "",
            responded_by: { id: "approver-1", name: "Frank" },
            responded_at: "2024-01-01T12:00:00Z",
            votes: [
              { approver_id: "user-1", approved: true },
              { approver_id: "user-2", approved: true },
              { approver_id: "user-3", approved: true },
            ],
          }),
        },
      });

      const result = await approval_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.votes).toHaveLength(3);
      expect(result.output.approved).toBe(true);
    });

    it("should include votes in result", async () => {
      const node = createMockApprovalNode({
        quorum: 2,
      });
      const ctx = createMockContext();
      const votes = [
        { approver_id: "user-1", approved: true, comment: "OK" },
        { approver_id: "user-2", approved: false, comment: "Wait" },
      ];
      const mockRunner = createMockRunnerContext({
        options: {
          workspace: { id: "workspace-1", api_key: "test-key" },
          ask_channel: vi.fn().mockResolvedValueOnce({
            approved: false,
            comment: "",
            responded_by: null,
            responded_at: "2024-01-01T12:00:00Z",
            votes: votes,
          }),
        },
      });

      const result = await approval_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.votes).toEqual(votes);
    });
  });

  describe("runner_execute — target channel", () => {
    it("should support origin target", async () => {
      const node = createMockApprovalNode({
        target: "origin",
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        options: {
          workspace: { id: "workspace-1", api_key: "test-key" },
          ask_channel: vi.fn().mockResolvedValueOnce({
            approved: true,
            comment: "",
            responded_by: { id: "approver-1", name: "Grace" },
            responded_at: "2024-01-01T12:00:00Z",
          }),
        },
      });

      await approval_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect((mockRunner.options.ask_channel as any)).toHaveBeenCalled();
    });

    it("should support specified target with channel", async () => {
      const node = createMockApprovalNode({
        target: "specified",
        channel: "approval-channel",
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        options: {
          workspace: { id: "workspace-1", api_key: "test-key" },
          ask_channel: vi.fn().mockResolvedValueOnce({
            approved: true,
            comment: "",
            responded_by: { id: "approver-1", name: "Henry" },
            responded_at: "2024-01-01T12:00:00Z",
          }),
        },
      });

      await approval_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect((mockRunner.options.ask_channel as any)).toHaveBeenCalled();
    });
  });

  describe("runner_execute — timeout", () => {
    it("should pass timeout to ask_channel", async () => {
      const node = createMockApprovalNode({
        timeout_ms: 30_000,
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        options: {
          workspace: { id: "workspace-1", api_key: "test-key" },
          ask_channel: vi.fn().mockResolvedValueOnce({
            approved: true,
            comment: "",
            responded_by: { id: "approver-1", name: "Iris" },
            responded_at: "2024-01-01T12:00:00Z",
          }),
        },
      });

      await approval_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      const callArgs = (mockRunner.options.ask_channel as any).mock.calls[0];
      expect(callArgs[1]).toBe(30_000);
    });

    it("should use default timeout when not specified", async () => {
      const node = createMockApprovalNode();
      delete node.timeout_ms;
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        options: {
          workspace: { id: "workspace-1", api_key: "test-key" },
          ask_channel: vi.fn().mockResolvedValueOnce({
            approved: true,
            comment: "",
            responded_by: { id: "approver-1", name: "Jack" },
            responded_at: "2024-01-01T12:00:00Z",
          }),
        },
      });

      await approval_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      const callArgs = (mockRunner.options.ask_channel as any).mock.calls[0];
      expect(callArgs[1]).toBe(600_000);
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid config", () => {
      const node = createMockApprovalNode({
        message: "Please approve",
        target: "origin",
      });
      const ctx = createMockContext();

      const result = approval_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when message is missing", () => {
      const node = createMockApprovalNode({
        message: "",
      });
      const ctx = createMockContext();

      const result = approval_handler.test(node, ctx);

      expect(result.warnings).toContain("message is required");
    });

    it("should warn when message is only whitespace", () => {
      const node = createMockApprovalNode({
        message: "   ",
      });
      const ctx = createMockContext();

      const result = approval_handler.test(node, ctx);

      expect(result.warnings).toContain("message is required");
    });

    it("should warn when target is specified but channel missing", () => {
      const node = createMockApprovalNode({
        target: "specified",
        channel: undefined,
      });
      const ctx = createMockContext();

      const result = approval_handler.test(node, ctx);

      expect(result.warnings).toContain("channel is required when target is 'specified'");
    });

    it("should warn when quorum is less than 1", () => {
      const node = createMockApprovalNode({
        quorum: 0,
      });
      const ctx = createMockContext();

      const result = approval_handler.test(node, ctx);

      expect(result.warnings).toContain("quorum must be at least 1");
    });

    it("should include message preview truncated to 100 chars", () => {
      const longMessage = "x".repeat(150);
      const node = createMockApprovalNode({
        message: longMessage,
      });
      const ctx = createMockContext();

      const result = approval_handler.test(node, ctx);

      expect(result.preview.message).toHaveLength(100);
      expect(result.preview.message).toBe("x".repeat(100));
    });

    it("should resolve template in preview message", () => {
      const node = createMockApprovalNode({
        message: "Deploy to {{memory.env}}",
      });
      const ctx = createMockContext({
        memory: { env: "staging" },
      });

      const result = approval_handler.test(node, ctx);

      expect(result.preview.message).toContain("staging");
    });

    it("should include target and quorum in preview", () => {
      const node = createMockApprovalNode({
        target: "specified",
        quorum: 5,
      });
      const ctx = createMockContext();

      const result = approval_handler.test(node, ctx);

      expect(result.preview.target).toBe("specified");
      expect(result.preview.quorum).toBe(5);
    });
  });

  describe("integration scenarios", () => {
    it("should handle single approver workflow", async () => {
      const node = createMockApprovalNode({
        message: "Please review the PR",
        quorum: 1,
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        options: {
          workspace: { id: "workspace-1", api_key: "test-key" },
          ask_channel: vi.fn().mockResolvedValueOnce({
            approved: true,
            comment: "LGTM",
            responded_by: { id: "reviewer-1", name: "Kate" },
            responded_at: "2024-01-01T14:00:00Z",
          }),
        },
      });

      const result = await approval_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.approved).toBe(true);
      expect(result.output.comment).toBe("LGTM");
    });

    it("should handle multi-approver consensus workflow", async () => {
      const node = createMockApprovalNode({
        message: "All three approvers must agree",
        quorum: 3,
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        options: {
          workspace: { id: "workspace-1", api_key: "test-key" },
          ask_channel: vi.fn().mockResolvedValueOnce({
            approved: true,
            comment: "Consensus reached",
            responded_by: { id: "approver-1", name: "Leo" },
            responded_at: "2024-01-01T15:00:00Z",
            votes: [
              { approver_id: "user-1", approved: true },
              { approver_id: "user-2", approved: true },
              { approver_id: "user-3", approved: true },
            ],
          }),
        },
      });

      const result = await approval_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.approved).toBe(true);
      expect(result.output.votes).toHaveLength(3);
    });

    it("should handle conditional approval with context", async () => {
      const node = createMockApprovalNode({
        message: "Approve {{memory.action}} on {{memory.resource}}",
        target: "specified",
        channel: "finance-approvals",
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        state: {
          workflow_id: "wf-1",
          agent_id: "agent-1",
          user_id: "user-1",
          workspace_id: "workspace-1",
          memory: {
            action: "delete",
            resource: "database_backup_001",
          },
        },
        options: {
          workspace: { id: "workspace-1", api_key: "test-key" },
          ask_channel: vi.fn().mockResolvedValueOnce({
            approved: false,
            comment: "Need backup verification first",
            responded_by: { id: "finance-lead", name: "Mike" },
            responded_at: "2024-01-01T16:00:00Z",
          }),
        },
      });

      const result = await approval_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.approved).toBe(false);
      expect(result.output.comment).toContain("backup");
    });
  });
});
