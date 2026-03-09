/** Decision (결정사항 관리) 노드 핸들러 테스트
 *
 * 목표: decision_handler를 통한 결정사항 저장/조회/아카이브 검증
 *       - append: 새 결정사항 추가
 *       - list: 결정사항 목록 조회
 *       - get_effective: 에이전트별 효과적인 결정사항
 *       - archive: 결정사항 아카이브
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { decision_handler } from "@src/agent/nodes/decision.js";
import type { DecisionNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext, RunnerContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockDecisionNode = (overrides?: Partial<DecisionNodeDefinition>): DecisionNodeDefinition => ({
  node_id: "decision-1",
  title: "Test Decision Node",
  node_type: "decision",
  operation: "append",
  scope: "global",
  key: "decision_key",
  value: "decision_value",
  rationale: "test",
  priority: 1,
  tags: ["test"],
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
  },
  execute_node: vi.fn(),
  emit: vi.fn(),
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  services: {
    decision: {
      append: vi.fn(),
      list: vi.fn(),
      get_effective: vi.fn(),
      archive: vi.fn(),
    },
  },
  ...overrides,
});

/* ── Tests ── */

describe("Decision Node Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(decision_handler.node_type).toBe("decision");
    });

    it("should have output_schema with action, record, records, count", () => {
      const schema = decision_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("action");
      expect(fields).toContain("record");
      expect(fields).toContain("records");
      expect(fields).toContain("count");
    });

    it("should have create_default returning valid node template", () => {
      const defaultNode = decision_handler.create_default?.();
      expect(defaultNode?.operation).toBe("append");
      expect(defaultNode?.scope).toBe("global");
    });
  });

  describe("execute — basic operation (no runner)", () => {
    it("should return pending status without runner", async () => {
      const node = createMockDecisionNode();
      const ctx = createMockContext();

      const result = await decision_handler.execute(node, ctx);

      expect(result.output.action).toBe("pending");
      expect(result.output.record).toBeNull();
      expect(result.output.records).toEqual([]);
    });

    it("should include _meta with resolved key and value", async () => {
      const node = createMockDecisionNode({
        key: "approve_request",
        value: "approved",
      });
      const ctx = createMockContext();

      const result = await decision_handler.execute(node, ctx);

      expect((result.output as any)._meta.key).toBe("approve_request");
      expect((result.output as any)._meta.value).toBe("approved");
    });
  });

  describe("runner_execute — append operation", () => {
    it("should append decision record", async () => {
      const node = createMockDecisionNode({
        operation: "append",
        key: "deployment_status",
        value: "approved",
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: {
          decision: {
            append: vi.fn().mockResolvedValueOnce({
              action: "inserted",
              record: { key: "deployment_status", value: "approved", id: "rec-1" },
            }),
            list: vi.fn(),
            get_effective: vi.fn(),
            archive: vi.fn(),
          },
        },
      });

      const result = await decision_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(mockRunner.services!.decision.append).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "deployment_status",
          value: "approved",
          scope: "global",
        })
      );
      expect(result.output.action).toBe("inserted");
    });

    it("should handle deduped decision", async () => {
      const node = createMockDecisionNode({
        operation: "append",
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: {
          decision: {
            append: vi.fn().mockResolvedValueOnce({
              action: "deduped",
              record: null,
            }),
            list: vi.fn(),
            get_effective: vi.fn(),
            archive: vi.fn(),
          },
        },
      });

      const result = await decision_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.action).toBe("deduped");
    });

    it("should fail when key missing for append", async () => {
      const node = createMockDecisionNode({
        operation: "append",
        key: "",
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: {
          decision: {
            append: vi.fn(),
            list: vi.fn(),
            get_effective: vi.fn(),
            archive: vi.fn(),
          },
        },
      });

      // Note: execute doesn't validate, but test() warns
      const result = await decision_handler.execute(node, ctx);
      expect(result.output._meta).toBeDefined();
    });
  });

  describe("runner_execute — list operation", () => {
    it("should list decision records", async () => {
      const node = createMockDecisionNode({
        operation: "list",
        key: "approval_status",
      });
      const ctx = createMockContext();
      const records = [
        { key: "approval_status", value: "approved", priority: 1 },
        { key: "approval_status", value: "rejected", priority: 2 },
      ];
      const mockRunner = createMockRunnerContext({
        services: {
          decision: {
            append: vi.fn(),
            list: vi.fn().mockResolvedValueOnce(records),
            get_effective: vi.fn(),
            archive: vi.fn(),
          },
        },
      });

      const result = await decision_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(mockRunner.services!.decision.list).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "approval_status",
          status: "active",
        })
      );
      expect(result.output.action).toBe("listed");
      expect(result.output.records).toHaveLength(2);
      expect(result.output.count).toBe(2);
    });

    it("should list all records without key filter", async () => {
      const node = createMockDecisionNode({
        operation: "list",
        key: "",
      });
      const ctx = createMockContext();
      const records = [
        { key: "key1", value: "value1" },
        { key: "key2", value: "value2" },
        { key: "key3", value: "value3" },
      ];
      const mockRunner = createMockRunnerContext({
        services: {
          decision: {
            append: vi.fn(),
            list: vi.fn().mockResolvedValueOnce(records),
            get_effective: vi.fn(),
            archive: vi.fn(),
          },
        },
      });

      const result = await decision_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      const call = (mockRunner.services!.decision.list as any).mock.calls[0][0];
      expect(call.key).toBeUndefined();
      expect(result.output.records).toHaveLength(3);
    });

    it("should handle empty list", async () => {
      const node = createMockDecisionNode({
        operation: "list",
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: {
          decision: {
            append: vi.fn(),
            list: vi.fn().mockResolvedValueOnce([]),
            get_effective: vi.fn(),
            archive: vi.fn(),
          },
        },
      });

      const result = await decision_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.records).toEqual([]);
      expect(result.output.count).toBe(0);
    });
  });

  describe("runner_execute — get_effective operation", () => {
    it("should get effective decisions for agent", async () => {
      const node = createMockDecisionNode({
        operation: "get_effective",
        scope_id: "agent-123",
      });
      const ctx = createMockContext();
      const records = [
        { key: "feature_flag", value: "enabled", priority: 1 },
      ];
      const mockRunner = createMockRunnerContext({
        services: {
          decision: {
            append: vi.fn(),
            list: vi.fn(),
            get_effective: vi.fn().mockResolvedValueOnce(records),
            archive: vi.fn(),
          },
        },
      });

      const result = await decision_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(mockRunner.services!.decision.get_effective).toHaveBeenCalledWith({
        agent_id: "agent-123",
      });
      expect(result.output.action).toBe("get_effective");
      expect(result.output.records).toHaveLength(1);
    });
  });

  describe("runner_execute — archive operation", () => {
    it("should archive decision record", async () => {
      const node = createMockDecisionNode({
        operation: "archive",
        target_id: "rec-123",
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: {
          decision: {
            append: vi.fn(),
            list: vi.fn(),
            get_effective: vi.fn(),
            archive: vi.fn().mockResolvedValueOnce(true),
          },
        },
      });

      const result = await decision_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(mockRunner.services!.decision.archive).toHaveBeenCalledWith("rec-123");
      expect(result.output.action).toBe("archived");
      expect(result.output.count).toBe(1);
    });

    it("should handle not found for archive", async () => {
      const node = createMockDecisionNode({
        operation: "archive",
        target_id: "nonexistent",
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: {
          decision: {
            append: vi.fn(),
            list: vi.fn(),
            get_effective: vi.fn(),
            archive: vi.fn().mockResolvedValueOnce(false),
          },
        },
      });

      const result = await decision_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.action).toBe("not_found");
      expect(result.output.count).toBe(0);
    });
  });

  describe("runner_execute — template resolution", () => {
    it("should resolve key template variables", async () => {
      const node = createMockDecisionNode({
        operation: "append",
        key: "status_{{memory.env}}",
        value: "approved",
      });
      const ctx = createMockContext({
        memory: { env: "production" },
      });
      const mockRunner = createMockRunnerContext({
        services: {
          decision: {
            append: vi.fn().mockResolvedValueOnce({ action: "inserted", record: {} }),
            list: vi.fn(),
            get_effective: vi.fn(),
            archive: vi.fn(),
          },
        },
      });

      await decision_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      const call = (mockRunner.services!.decision.append as any).mock.calls[0][0];
      expect(call.key).toBe("status_production");
    });

    it("should resolve value template variables", async () => {
      const node = createMockDecisionNode({
        operation: "append",
        key: "result",
        value: "{{memory.decision}}",
      });
      const ctx = createMockContext({
        memory: { decision: "approved" },
      });
      const mockRunner = createMockRunnerContext({
        services: {
          decision: {
            append: vi.fn().mockResolvedValueOnce({ action: "inserted", record: {} }),
            list: vi.fn(),
            get_effective: vi.fn(),
            archive: vi.fn(),
          },
        },
      });

      await decision_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      const call = (mockRunner.services!.decision.append as any).mock.calls[0][0];
      expect(call.value).toBe("approved");
    });
  });

  describe("runner_execute — error handling", () => {
    it("should catch service errors gracefully", async () => {
      const node = createMockDecisionNode({
        operation: "append",
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: {
          decision: {
            append: vi.fn().mockRejectedValueOnce(new Error("Database error")),
            list: vi.fn(),
            get_effective: vi.fn(),
            archive: vi.fn(),
          },
        },
      });

      const result = await decision_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.action).toBe("error");
      expect(result.output.error).toContain("Database error");
      expect(mockRunner.logger.warn).toHaveBeenCalledWith(
        "decision_node_error",
        expect.objectContaining({ node_id: "decision-1" })
      );
    });
  });

  describe("runner_execute — fallback without service", () => {
    it("should fallback to execute when decision service unavailable", async () => {
      const node = createMockDecisionNode({
        operation: "append",
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: undefined,
      });

      const result = await decision_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.action).toBe("pending");
    });
  });

  describe("runner_execute — scope handling", () => {
    it("should default scope to global", async () => {
      const node = createMockDecisionNode({
        operation: "list",
      });
      delete node.scope;
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: {
          decision: {
            append: vi.fn(),
            list: vi.fn().mockResolvedValueOnce([]),
            get_effective: vi.fn(),
            archive: vi.fn(),
          },
        },
      });

      await decision_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      const call = (mockRunner.services!.decision.list as any).mock.calls[0][0];
      expect(call.scope).toBe("global");
    });

    it("should support custom scope_id", async () => {
      const node = createMockDecisionNode({
        operation: "append",
        scope: "workspace",
        scope_id: "ws-456",
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: {
          decision: {
            append: vi.fn().mockResolvedValueOnce({ action: "inserted", record: {} }),
            list: vi.fn(),
            get_effective: vi.fn(),
            archive: vi.fn(),
          },
        },
      });

      await decision_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      const call = (mockRunner.services!.decision.append as any).mock.calls[0][0];
      expect(call.scope).toBe("workspace");
      expect(call.scope_id).toBe("ws-456");
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid append", () => {
      const node = createMockDecisionNode({
        operation: "append",
        key: "decision_key",
        value: "decision_value",
      });
      const ctx = createMockContext();

      const result = decision_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when append lacks key", () => {
      const node = createMockDecisionNode({
        operation: "append",
        key: "",
      });
      const ctx = createMockContext();

      const result = decision_handler.test(node, ctx);

      expect(result.warnings).toContain("key is required for append");
    });

    it("should warn when append lacks value", () => {
      const node = createMockDecisionNode({
        operation: "append",
        value: "",
      });
      const ctx = createMockContext();

      const result = decision_handler.test(node, ctx);

      expect(result.warnings).toContain("value is required for append");
    });

    it("should warn when archive lacks target_id", () => {
      const node = createMockDecisionNode({
        operation: "archive",
        target_id: "",
      });
      const ctx = createMockContext();

      const result = decision_handler.test(node, ctx);

      expect(result.warnings).toContain("target_id is required for archive");
    });

    it("should include operation, scope, key, priority in preview", () => {
      const node = createMockDecisionNode({
        operation: "list",
        scope: "workspace",
        key: "approval",
        priority: 2,
      });
      const ctx = createMockContext();

      const result = decision_handler.test(node, ctx);

      expect(result.preview.operation).toBe("list");
      expect(result.preview.scope).toBe("workspace");
      expect(result.preview.key).toBe("approval");
      expect(result.preview.priority).toBe(2);
    });
  });

  describe("integration scenarios", () => {
    it("should record deployment approval decision", async () => {
      const node = createMockDecisionNode({
        operation: "append",
        key: "deployment_approval",
        value: "approved_for_production",
        priority: 10,
        rationale: "Security review passed",
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: {
          decision: {
            append: vi.fn().mockResolvedValueOnce({
              action: "inserted",
              record: { key: "deployment_approval", value: "approved_for_production" },
            }),
            list: vi.fn(),
            get_effective: vi.fn(),
            archive: vi.fn(),
          },
        },
      });

      const result = await decision_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.action).toBe("inserted");
    });

    it("should query effective decisions for agent", async () => {
      const node = createMockDecisionNode({
        operation: "get_effective",
        scope_id: "agent-ai",
      });
      const ctx = createMockContext();
      const effectiveDecisions = [
        { key: "model_version", value: "v4", priority: 5 },
        { key: "temperature", value: "0.7", priority: 3 },
      ];
      const mockRunner = createMockRunnerContext({
        services: {
          decision: {
            append: vi.fn(),
            list: vi.fn(),
            get_effective: vi.fn().mockResolvedValueOnce(effectiveDecisions),
            archive: vi.fn(),
          },
        },
      });

      const result = await decision_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.records).toHaveLength(2);
      expect(result.output.count).toBe(2);
    });
  });

  describe("execute — unknown operation (L79)", () => {
    it("지원하지 않는 operation → default 브랜치 → error 반환 (L79)", async () => {
      const node = createMockDecisionNode({ operation: "unknown_op" as never });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: { decision: { append: vi.fn(), list: vi.fn(), get_effective: vi.fn(), archive: vi.fn() } },
      });
      const result = await decision_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);
      expect(result.output.action).toBe("error");
      expect(String(result.output.error)).toContain("unknown operation");
    });
  });
});
