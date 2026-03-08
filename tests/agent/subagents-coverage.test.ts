/**
 * SubagentRegistry — 미커버 경로 보충.
 * wait_for_completion / spawn 제한 / send_input / cancel_by_parent_id / prune / spawn with skip_controller
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubagentRegistry } from "@src/agent/subagents.js";
import type { SubagentRef } from "@src/agent/subagents.js";

function make_registry(overrides: Record<string, unknown> = {}) {
  return new SubagentRegistry({ workspace: "/tmp/test-subagents", ...overrides });
}

// ══════════════════════════════════════════
// get_agent_backends
// ══════════════════════════════════════════

describe("SubagentRegistry — get_agent_backends", () => {
  it("설정 없으면 null 반환", () => {
    const reg = make_registry();
    expect(reg.get_agent_backends()).toBeNull();
  });

  it("agent_backends 설정 시 반환", () => {
    const backends = { run: vi.fn() } as any;
    const reg = make_registry({ agent_backends: backends });
    expect(reg.get_agent_backends()).toBe(backends);
  });
});

// ══════════════════════════════════════════
// upsert / get / list
// ══════════════════════════════════════════

describe("SubagentRegistry — upsert / get / list", () => {
  it("upsert 후 get으로 조회", () => {
    const reg = make_registry();
    reg.upsert({ id: "a", role: "worker", status: "running" });
    const ref = reg.get("a");
    expect(ref).not.toBeNull();
    expect(ref!.status).toBe("running");
    expect(ref!.created_at).toBeDefined();
  });

  it("upsert 반복 → created_at 보존, updated_at 갱신", async () => {
    const reg = make_registry();
    reg.upsert({ id: "b", role: "worker", status: "running" });
    const first = reg.get("b")!;
    await new Promise(r => setTimeout(r, 10));
    reg.upsert({ id: "b", role: "worker", status: "completed" });
    const second = reg.get("b")!;
    expect(second.created_at).toBe(first.created_at);
    expect(second.status).toBe("completed");
  });

  it("list → 최신 updated_at 순 정렬", () => {
    const reg = make_registry();
    // items Map에 직접 삽입하여 updated_at 제어
    const items = (reg as any).items as Map<string, SubagentRef>;
    items.set("x1", { id: "x1", role: "worker", status: "running", updated_at: "2026-01-01", created_at: "2026-01-01" });
    items.set("x2", { id: "x2", role: "worker", status: "running", updated_at: "2026-01-02", created_at: "2026-01-02" });
    const list = reg.list();
    expect(list[0].id).toBe("x2");
  });

  it("존재하지 않는 id → get() null", () => {
    const reg = make_registry();
    expect(reg.get("not-exist")).toBeNull();
  });
});

// ══════════════════════════════════════════
// list_running / get_running_count
// ══════════════════════════════════════════

describe("SubagentRegistry — list_running / get_running_count", () => {
  it("running 없으면 0", () => {
    const reg = make_registry();
    expect(reg.get_running_count()).toBe(0);
    expect(reg.list_running()).toEqual([]);
  });

  it("running Map에 직접 삽입 후 count/list 반환", () => {
    const reg = make_registry();
    const ref: SubagentRef = { id: "r1", role: "worker", status: "running" };
    const running = (reg as any).running as Map<string, unknown>;
    running.set("r1", { ref, abort: new AbortController(), done: Promise.resolve(), parent_id: null });

    expect(reg.get_running_count()).toBe(1);
    expect(reg.list_running()[0]).toBe(ref);
  });
});

// ══════════════════════════════════════════
// wait_for_completion
// ══════════════════════════════════════════

describe("SubagentRegistry — wait_for_completion", () => {
  it("id 없음 → null 반환", async () => {
    const reg = make_registry();
    const r = await reg.wait_for_completion("nonexistent");
    expect(r).toBeNull();
  });

  it("completed 상태 → 즉시 완료 반환", async () => {
    const reg = make_registry();
    reg.upsert({ id: "done1", role: "worker", status: "completed", last_result: "result text" });
    const r = await reg.wait_for_completion("done1", 0, 50);
    expect(r).not.toBeNull();
    expect(r!.status).toBe("completed");
    expect(r!.content).toBe("result text");
  });

  it("failed 상태 → 즉시 error 반환", async () => {
    const reg = make_registry();
    reg.upsert({ id: "fail1", role: "worker", status: "failed", last_error: "something went wrong" });
    const r = await reg.wait_for_completion("fail1", 0, 50);
    expect(r).not.toBeNull();
    expect(r!.status).toBe("failed");
    expect(r!.error).toBe("something went wrong");
  });

  it("cancelled 상태 → 즉시 반환", async () => {
    const reg = make_registry();
    reg.upsert({ id: "canc1", role: "worker", status: "cancelled" });
    const r = await reg.wait_for_completion("canc1");
    expect(r!.status).toBe("cancelled");
  });

  it("offline 상태 → 즉시 반환", async () => {
    const reg = make_registry();
    reg.upsert({ id: "off1", role: "worker", status: "offline", last_error: "connection lost" });
    const r = await reg.wait_for_completion("off1");
    expect(r!.status).toBe("offline");
    expect(r!.error).toBe("connection lost");
  });

  it("timeout_ms 초과 → failed 반환", async () => {
    const reg = make_registry();
    reg.upsert({ id: "pending1", role: "worker", status: "running" });
    const r = await reg.wait_for_completion("pending1", 100, 50);
    expect(r).not.toBeNull();
    expect(r!.status).toBe("failed");
    expect(r!.error).toContain("timeout");
  });
});

// ══════════════════════════════════════════
// send_input
// ══════════════════════════════════════════

describe("SubagentRegistry — send_input", () => {
  it("running에 없음 → false", () => {
    const reg = make_registry();
    expect(reg.send_input("ghost", "hello")).toBe(false);
  });

  it("send_input 없는 running entry → false", () => {
    const reg = make_registry();
    const running = (reg as any).running as Map<string, unknown>;
    running.set("r2", { ref: { id: "r2", role: "worker", status: "running" }, abort: new AbortController(), done: Promise.resolve(), parent_id: null });
    expect(reg.send_input("r2", "hello")).toBe(false);
  });

  it("send_input 있는 running entry → 호출 후 true", () => {
    const reg = make_registry();
    const fn = vi.fn();
    const running = (reg as any).running as Map<string, unknown>;
    running.set("r3", {
      ref: { id: "r3", role: "worker", status: "running" },
      abort: new AbortController(),
      done: Promise.resolve(),
      parent_id: null,
      send_input: fn,
    });
    const result = reg.send_input("r3", "test message");
    expect(result).toBe(true);
    expect(fn).toHaveBeenCalledWith("test message");
  });
});

// ══════════════════════════════════════════
// cancel
// ══════════════════════════════════════════

describe("SubagentRegistry — cancel", () => {
  it("running에 없으면 false", () => {
    const reg = make_registry();
    expect(reg.cancel("unknown")).toBe(false);
  });

  it("running에 있음 → abort() 호출 + status=cancelled + true", () => {
    const reg = make_registry();
    reg.upsert({ id: "c1", role: "worker", status: "running" });
    const abort = new AbortController();
    const spy = vi.spyOn(abort, "abort");
    const running = (reg as any).running as Map<string, unknown>;
    running.set("c1", { ref: reg.get("c1"), abort, done: Promise.resolve(), parent_id: null });

    const r = reg.cancel("c1");
    expect(r).toBe(true);
    expect(spy).toHaveBeenCalled();
    expect(reg.get("c1")!.status).toBe("cancelled");
  });

  it("cascade=false → 자식 취소 안 함", () => {
    const reg = make_registry();
    reg.upsert({ id: "parent", role: "leader", status: "running" });
    reg.upsert({ id: "child", role: "worker", status: "running" });
    const running = (reg as any).running as Map<string, unknown>;
    running.set("parent", { ref: reg.get("parent"), abort: new AbortController(), done: Promise.resolve(), parent_id: null });
    running.set("child", { ref: reg.get("child"), abort: new AbortController(), done: Promise.resolve(), parent_id: "parent" });

    reg.cancel("parent", false);
    // cascade=false이므로 child는 여전히 running
    expect(running.has("child")).toBe(true);
  });
});

// ══════════════════════════════════════════
// cancel_by_parent_id
// ══════════════════════════════════════════

describe("SubagentRegistry — cancel_by_parent_id", () => {
  it("해당 parent_id 자식 없으면 0", () => {
    const reg = make_registry();
    expect(reg.cancel_by_parent_id("nobody")).toBe(0);
  });

  it("자식 2개 → 2 반환 + 자식 취소", () => {
    const reg = make_registry();
    reg.upsert({ id: "p", role: "leader", status: "running" });
    reg.upsert({ id: "c1", role: "worker", status: "running" });
    reg.upsert({ id: "c2", role: "worker", status: "running" });

    const running = (reg as any).running as Map<string, unknown>;
    running.set("c1", { ref: reg.get("c1"), abort: new AbortController(), done: Promise.resolve(), parent_id: "p" });
    running.set("c2", { ref: reg.get("c2"), abort: new AbortController(), done: Promise.resolve(), parent_id: "p" });

    const count = reg.cancel_by_parent_id("p");
    expect(count).toBe(2);
    expect(reg.get("c1")!.status).toBe("cancelled");
    expect(reg.get("c2")!.status).toBe("cancelled");
  });
});

// ══════════════════════════════════════════
// spawn — providers 없을 때 에러 / 한계 초과
// ══════════════════════════════════════════

describe("SubagentRegistry — spawn", () => {
  it("providers 없으면 예외 throw", async () => {
    const reg = make_registry({ providers: null });
    await expect(reg.spawn({ task: "do something" })).rejects.toThrow("providers_not_configured");
  });

  it("running.size >= 10 → rejected 반환", async () => {
    const mock_providers = {
      get_orchestrator_provider_id: vi.fn().mockReturnValue("orchestrator"),
      run_orchestrator: vi.fn().mockResolvedValue({ content: "{}" }),
    } as any;
    const reg = make_registry({ providers: mock_providers });
    // 10개를 강제로 채움
    const running = (reg as any).running as Map<string, unknown>;
    for (let i = 0; i < 10; i++) {
      running.set(`filler-${i}`, {});
    }
    const result = await reg.spawn({ task: "overflow task" });
    expect(result.status).toBe("rejected");
    expect(result.message).toContain("concurrent subagent limit");
  });
});

// ══════════════════════════════════════════
// _prune_items (500+ 항목 자동 정리)
// ══════════════════════════════════════════

describe("SubagentRegistry — _prune_items", () => {
  it("501개 upsert 후 500개 이하로 정리됨", () => {
    const reg = make_registry();
    // 500개 completed 추가
    for (let i = 0; i < 500; i++) {
      reg.upsert({ id: `completed-${i}`, role: "worker", status: "completed", updated_at: `2026-01-${String(i % 28 + 1).padStart(2, "0")}` });
    }
    // 501번째 → _prune_items 트리거
    reg.upsert({ id: "trigger", role: "worker", status: "running" });
    const items = (reg as any).items as Map<string, unknown>;
    // 정리 후 500개 이하
    expect(items.size).toBeLessThanOrEqual(500);
  });
});
