/**
 * 특수 노드 런너 핸들링 테스트.
 * phase-loop-runner의 execute_special_node 로직을 간접 검증.
 * 실제 run_phase_loop을 호출하는 대신 개별 노드 핸들러의 execute()를 직접 테스트하고,
 * 콜백 제공/미제공 시 graceful degradation을 확인.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { register_all_nodes } from "../../src/agent/nodes/index.js";
import { execute_orche_node, test_orche_node } from "../../src/agent/orche-node-executor.js";
import type { OrcheNodeExecutorContext } from "../../src/agent/orche-node-executor.js";
import type {
  HitlNodeDefinition,
  ApprovalNodeDefinition,
  FormNodeDefinition,
  NotifyNodeDefinition,
  SendFileNodeDefinition,
  EscalationNodeDefinition,
  CacheNodeDefinition,
  RetryNodeDefinition,
  BatchNodeDefinition,
  AssertNodeDefinition,
  GateNodeDefinition,
  ToolInvokeNodeDefinition,
} from "../../src/agent/workflow-node.types.js";

beforeAll(() => {
  register_all_nodes();
});

const base_ctx: OrcheNodeExecutorContext = {
  memory: { prev_node: { value: "hello" } },
};

// ── HITL: 핸들러 fallback (ask_channel 없을 때) ──

describe("hitl handler fallback", () => {
  it("콜백 없을 때 빈 응답 반환", async () => {
    const node: HitlNodeDefinition = {
      node_id: "hitl_1", node_type: "hitl", title: "Ask User",
      prompt: "What is your name?", target: "origin", timeout_ms: 5000,
    };
    const result = await execute_orche_node(node, base_ctx);
    expect(result.output).toHaveProperty("response");
    expect(result.output).toHaveProperty("timed_out");
  });
});

// ── Approval: 핸들러 fallback ──

describe("approval handler fallback", () => {
  it("콜백 없을 때 approved=false 반환", async () => {
    const node: ApprovalNodeDefinition = {
      node_id: "approval_1", node_type: "approval", title: "Approve Deploy",
      message: "Deploy to production?", target: "origin", quorum: 1,
    };
    const result = await execute_orche_node(node, base_ctx);
    expect((result.output as Record<string, unknown>).approved).toBe(false);
  });
});

// ── Form: 핸들러 fallback ──

describe("form handler fallback", () => {
  it("콜백 없을 때 빈 fields 반환", async () => {
    const node: FormNodeDefinition = {
      node_id: "form_1", node_type: "form", title: "User Info",
      target: "origin",
      fields: [{ name: "email", label: "Email", type: "text", required: true }],
    };
    const result = await execute_orche_node(node, base_ctx);
    expect((result.output as Record<string, unknown>).fields).toEqual({});
  });
});

// ── Notify: 핸들러 fallback ──

describe("notify handler fallback", () => {
  it("콜백 없을 때 ok=true 반환 (no-op)", async () => {
    const node: NotifyNodeDefinition = {
      node_id: "notify_1", node_type: "notify", title: "Notify",
      content: "Task completed: {{memory.prev_node.value}}", target: "origin",
    };
    const result = await execute_orche_node(node, base_ctx);
    expect((result.output as Record<string, unknown>).ok).toBe(true);
  });
});

// ── SendFile: 핸들러 fallback ──

describe("send_file handler fallback", () => {
  it("콜백 없을 때 ok=true 반환", async () => {
    const node: SendFileNodeDefinition = {
      node_id: "sf_1", node_type: "send_file", title: "Send Report",
      file_path: "/tmp/report.pdf", target: "origin",
    };
    const result = await execute_orche_node(node, base_ctx);
    expect((result.output as Record<string, unknown>).ok).toBe(true);
  });
});

// ── Escalation: 핸들러 fallback ──

describe("escalation handler fallback", () => {
  it("콜백 없을 때 escalated=false 반환", async () => {
    const node: EscalationNodeDefinition = {
      node_id: "esc_1", node_type: "escalation", title: "Escalate",
      condition: "always", message: "Need help", target_channel: "slack", priority: "high",
    };
    const result = await execute_orche_node(node, base_ctx);
    expect((result.output as Record<string, unknown>).escalated).toBe(false);
  });
});

// ── Cache: 실제 execute 동작 ──

describe("cache handler", () => {
  it("get_or_set: depends_on 결과를 캐시하고 반환", async () => {
    const node: CacheNodeDefinition = {
      node_id: "cache_1", node_type: "cache", title: "Cache",
      cache_key: "test_key", ttl_ms: 60000, operation: "get_or_set",
      depends_on: ["prev_node"],
    };
    const ctx: OrcheNodeExecutorContext = {
      memory: { prev_node: { value: "cached_data" } },
    };
    const result = await execute_orche_node(node, ctx);
    const output = result.output as Record<string, unknown>;
    expect(output.hit).toBeDefined();
    expect(output.cache_key).toBe("test_key");
  });
});

// ── Gate: quorum 체크 ──

describe("gate handler", () => {
  it("depends_on 완료 수가 quorum 이상이면 quorum_met=true", async () => {
    const node: GateNodeDefinition = {
      node_id: "gate_1", node_type: "gate", title: "Gate",
      quorum: 2, depends_on: ["node_a", "node_b", "node_c"],
    };
    const ctx: OrcheNodeExecutorContext = {
      memory: { node_a: "done", node_b: "done" },
    };
    const result = await execute_orche_node(node, ctx);
    const output = result.output as Record<string, unknown>;
    expect(output.quorum_met).toBe(true);
    expect((output.completed as string[]).length).toBe(2);
    expect((output.pending as string[]).length).toBe(1);
  });

  it("미달 시 quorum_met=false", async () => {
    const node: GateNodeDefinition = {
      node_id: "gate_2", node_type: "gate", title: "Gate",
      quorum: 3, depends_on: ["node_a", "node_b", "node_c"],
    };
    const ctx: OrcheNodeExecutorContext = {
      memory: { node_a: "done" },
    };
    const result = await execute_orche_node(node, ctx);
    expect((result.output as Record<string, unknown>).quorum_met).toBe(false);
  });
});

// ── Assert: 조건 평가 ──

describe("assert handler", () => {
  it("모든 조건 통과 시 valid=true", async () => {
    const node: AssertNodeDefinition = {
      node_id: "assert_1", node_type: "assert", title: "Assert",
      assertions: [
        { condition: "memory.prev_node.value === 'hello'", message: "should be hello" },
      ],
      on_fail: "continue",
    };
    const result = await execute_orche_node(node, base_ctx);
    const output = result.output as Record<string, unknown>;
    expect(output.valid).toBe(true);
    expect((output.errors as string[]).length).toBe(0);
  });

  it("조건 실패 + on_fail=continue → valid=false, errors 포함", async () => {
    const node: AssertNodeDefinition = {
      node_id: "assert_2", node_type: "assert", title: "Assert",
      assertions: [
        { condition: "memory.prev_node.value === 'wrong'", message: "mismatch" },
      ],
      on_fail: "continue",
    };
    const result = await execute_orche_node(node, base_ctx);
    const output = result.output as Record<string, unknown>;
    expect(output.valid).toBe(false);
    expect((output.errors as string[]).length).toBe(1);
  });

  it("조건 실패 + on_fail=halt → 에러 throw", async () => {
    const node: AssertNodeDefinition = {
      node_id: "assert_3", node_type: "assert", title: "Assert",
      assertions: [
        { condition: "memory.prev_node.value === 'wrong'", message: "halt test" },
      ],
      on_fail: "halt",
    };
    await expect(execute_orche_node(node, base_ctx)).rejects.toThrow();
  });
});

// ── Tool Invoke: 핸들러 fallback ──

describe("tool_invoke handler fallback", () => {
  it("tool_id 비어있으면 ok=false", async () => {
    const node: ToolInvokeNodeDefinition = {
      node_id: "ti_1", node_type: "tool_invoke", title: "Invoke",
      tool_id: "", params: {},
    };
    const result = await execute_orche_node(node, base_ctx);
    expect((result.output as Record<string, unknown>).ok).toBe(false);
  });

  it("tool_id 있으면 ok=true (stub)", async () => {
    const node: ToolInvokeNodeDefinition = {
      node_id: "ti_2", node_type: "tool_invoke", title: "Invoke",
      tool_id: "my_tool", params: { key: "val" },
    };
    const result = await execute_orche_node(node, base_ctx);
    const output = result.output as Record<string, unknown>;
    expect(output.ok).toBe(true);
    expect(output.tool_id).toBe("my_tool");
  });
});

// ── Retry: 핸들러 fallback ──

describe("retry handler fallback", () => {
  it("target_node의 memory 결과를 반환", async () => {
    const node: RetryNodeDefinition = {
      node_id: "retry_1", node_type: "retry", title: "Retry",
      target_node: "prev_node", max_attempts: 3,
    };
    const result = await execute_orche_node(node, base_ctx);
    const output = result.output as Record<string, unknown>;
    expect(output.result).toEqual({ value: "hello" });
    expect(output.succeeded).toBe(true);
  });
});

// ── Batch: 핸들러 fallback ──

describe("batch handler fallback", () => {
  it("배열 크기를 카운트하고 빈 결과 반환", async () => {
    const ctx: OrcheNodeExecutorContext = {
      memory: { items: [1, 2, 3] },
    };
    const node: BatchNodeDefinition = {
      node_id: "batch_1", node_type: "batch", title: "Batch",
      array_field: "items", body_node: "process", concurrency: 2,
    };
    const result = await execute_orche_node(node, ctx);
    const output = result.output as Record<string, unknown>;
    expect(output.total).toBe(3);
    expect(output.succeeded).toBe(0);
  });
});

// ── test() 메서드: 경고 검증 ──

describe("node test() warnings", () => {
  it("hitl: 빈 prompt → 경고", () => {
    const node: HitlNodeDefinition = {
      node_id: "t_hitl", node_type: "hitl", title: "Test",
      prompt: "", target: "specified",
    };
    const result = test_orche_node(node, base_ctx);
    expect(result.warnings).toContain("prompt is required");
    expect(result.warnings).toContain("channel is required when target is 'specified'");
  });

  it("gate: depends_on 비어있으면 경고", () => {
    const node: GateNodeDefinition = {
      node_id: "t_gate", node_type: "gate", title: "Test",
      quorum: 1,
    };
    const result = test_orche_node(node, base_ctx);
    expect(result.warnings.some((w: string) => w.includes("depends_on"))).toBe(true);
  });
});
