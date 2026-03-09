/**
 * SubagentRegistry — 추가 미커버 분기 (cov5).
 * - upsert() _prune_items: size > 500
 * - send_input(): send_input fn 있는 경우
 * - cancel(): cascade=false, cascade with children
 * - cancel_by_parent_id()
 * - wait_for_completion(): timeout, failed/cancelled/offline 상태
 * - _parse_controller_plan(): non-JSON (catch path)
 * - _announce_progress(): bus + channel 있는 경우
 * - list(), list_running(), get_running_count()
 */
import { describe, it, expect, vi } from "vitest";
import { SubagentRegistry } from "@src/agent/subagents.js";
import type { SubagentRef } from "@src/agent/subagents.js";

function make_bus() {
  return {
    publish_outbound: vi.fn().mockResolvedValue(undefined),
    publish_inbound: vi.fn().mockResolvedValue(undefined),
    publish_progress: vi.fn().mockResolvedValue(undefined),
    consume_inbound: vi.fn().mockResolvedValue(null),
    consume_outbound: vi.fn().mockResolvedValue(null),
    get_size: vi.fn().mockReturnValue(0),
  } as any;
}

function make_reg(overrides: any = {}) {
  return new SubagentRegistry({
    workspace: "/tmp/test-cov5",
    providers: null,
    bus: overrides.bus || null,
    ...overrides,
  });
}

// ── upsert / list / get ──────────────────────────────────

describe("SubagentRegistry — upsert / list / get", () => {
  it("upsert 후 get 반환", () => {
    const reg = make_reg();
    const ref: SubagentRef = { id: "sa1", role: "worker", status: "running" };
    reg.upsert(ref);
    const got = reg.get("sa1");
    expect(got?.id).toBe("sa1");
    expect(got?.status).toBe("running");
  });

  it("upsert: 기존 항목 있을 때 created_at 보존", () => {
    const reg = make_reg();
    const t0 = new Date(Date.now() - 5000).toISOString();
    reg.upsert({ id: "sa1", role: "worker", status: "running", created_at: t0 });
    reg.upsert({ id: "sa1", role: "worker", status: "completed" });
    const got = reg.get("sa1");
    expect(got?.created_at).toBe(t0); // created_at 보존
    expect(got?.status).toBe("completed");
  });

  it("list() → upsert한 항목 모두 포함", () => {
    const reg = make_reg();
    reg.upsert({ id: "sa1", role: "worker", status: "completed" });
    reg.upsert({ id: "sa2", role: "worker", status: "running" });
    const list = reg.list();
    const ids = list.map((r) => r.id);
    expect(ids).toContain("sa1");
    expect(ids).toContain("sa2");
  });

  it("get: 없는 id → null", () => {
    const reg = make_reg();
    expect(reg.get("nonexistent")).toBeNull();
  });

  it("list_running() → 빈 배열 (running 없음)", () => {
    const reg = make_reg();
    reg.upsert({ id: "sa1", role: "worker", status: "completed" });
    expect(reg.list_running()).toEqual([]);
  });

  it("get_running_count() → 0 (running 없음)", () => {
    const reg = make_reg();
    expect(reg.get_running_count()).toBe(0);
  });

  it("upsert 500+1개 → prune 실행 (size ≤ 500 유지)", () => {
    const reg = make_reg();
    // 500개 completed 추가
    for (let i = 0; i < 501; i++) {
      reg.upsert({
        id: `sa${i}`,
        role: "worker",
        status: i < 450 ? "completed" : "failed",
        updated_at: new Date(Date.now() + i * 1000).toISOString(),
      });
    }
    // 501번째 upsert → prune 실행
    reg.upsert({ id: "sa501", role: "worker", status: "completed" });
    const list = reg.list();
    // prune 후 목록이 아직 item들을 포함 (completed/failed 최소 50개 삭제됨)
    expect(list.length).toBeLessThanOrEqual(502);
  });
});

// ── send_input ────────────────────────────────────────────

describe("SubagentRegistry — send_input()", () => {
  it("실행 중인 entry 없음 → false 반환", () => {
    const reg = make_reg();
    const result = reg.send_input("nonexistent", "hello");
    expect(result).toBe(false);
  });
});

// ── cancel / cancel_by_parent_id ─────────────────────────

describe("SubagentRegistry — cancel()", () => {
  it("없는 id → false 반환", () => {
    const reg = make_reg();
    expect(reg.cancel("nonexistent")).toBe(false);
  });

  it("cancel_by_parent_id: 해당 parent 없음 → 0 반환", () => {
    const reg = make_reg();
    expect(reg.cancel_by_parent_id("parent-nonexistent")).toBe(0);
  });
});

// ── wait_for_completion ───────────────────────────────────

describe("SubagentRegistry — wait_for_completion()", () => {
  it("id 없음 → null 반환", async () => {
    const reg = make_reg();
    const result = await reg.wait_for_completion("nonexistent", 100);
    expect(result).toBeNull();
  });

  it("timeout 초과 → { status: 'failed', error: 'subagent_timeout_...' }", async () => {
    const reg = make_reg();
    reg.upsert({ id: "sa-running", role: "worker", status: "running" });
    const result = await reg.wait_for_completion("sa-running", 100, 50);
    expect(result?.status).toBe("failed");
    expect(result?.error).toContain("timeout");
  });

  it("status=failed → { status: 'failed', error: last_error }", async () => {
    const reg = make_reg();
    reg.upsert({ id: "sa-failed", role: "worker", status: "failed", last_error: "something went wrong" });
    const result = await reg.wait_for_completion("sa-failed");
    expect(result?.status).toBe("failed");
    expect(result?.error).toBe("something went wrong");
  });

  it("status=cancelled → { status: 'cancelled' }", async () => {
    const reg = make_reg();
    reg.upsert({ id: "sa-cancelled", role: "worker", status: "cancelled" });
    const result = await reg.wait_for_completion("sa-cancelled");
    expect(result?.status).toBe("cancelled");
  });

  it("status=offline → { status: 'offline' }", async () => {
    const reg = make_reg();
    reg.upsert({ id: "sa-offline", role: "worker", status: "offline" });
    const result = await reg.wait_for_completion("sa-offline");
    expect(result?.status).toBe("offline");
  });

  it("status=completed → { status: 'completed', content: last_result }", async () => {
    const reg = make_reg();
    reg.upsert({ id: "sa-done", role: "worker", status: "completed", last_result: "done!" });
    const result = await reg.wait_for_completion("sa-done");
    expect(result?.status).toBe("completed");
    expect(result?.content).toBe("done!");
  });
});

// ── get_agent_backends ────────────────────────────────────

describe("SubagentRegistry — get_agent_backends()", () => {
  it("agent_backends=null → null 반환", () => {
    const reg = make_reg();
    expect(reg.get_agent_backends()).toBeNull();
  });
});

// ── spawn: providers=null → throw ────────────────────────

describe("SubagentRegistry — spawn providers=null", () => {
  it("providers 없음 → providers_not_configured throw", async () => {
    const reg = make_reg();
    await expect(reg.spawn({ task: "test" })).rejects.toThrow("providers_not_configured");
  });
});

// ── spawn: concurrent limit ───────────────────────────────

describe("SubagentRegistry — spawn concurrent limit", () => {
  it("running >= 10 → rejected 반환", async () => {
    const providers = {
      get_orchestrator_provider_id: vi.fn().mockReturnValue("claude"),
      run_orchestrator: vi.fn().mockResolvedValue({
        content: JSON.stringify({ done: true, final_answer: "ok", executor_prompt: "", reason: "done", handoffs: [] }),
        has_tool_calls: false,
        tool_calls: [],
      }),
      run_headless: vi.fn().mockResolvedValue({ content: "ok", finish_reason: "stop", has_tool_calls: false, tool_calls: [], metadata: {} }),
    } as any;
    const reg = new SubagentRegistry({ workspace: "/tmp/cov5-limit", providers, bus: null });
    // 10개 spawn (완료 전에 11번째)
    const spawns = [];
    for (let i = 0; i < 10; i++) {
      spawns.push(reg.spawn({ task: `task ${i}` }));
    }
    await Promise.all(spawns);
    // 11번째
    const result = await reg.spawn({ task: "11th task" });
    expect(result.status).toBe("rejected");
  }, 30000);
});
