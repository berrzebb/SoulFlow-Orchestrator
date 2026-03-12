/**
 * SubagentRegistry — 공개 API 통합 테스트.
 * coverage + cov3 통합. 중복 제거 후 real-spawn 기반 우선, _prune_items만 Map 주입 유지.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubagentRegistry } from "@src/agent/subagents.js";

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────

function make_providers() {
  return {
    get_orchestrator_provider_id: vi.fn().mockReturnValue("claude"),
    run_orchestrator: vi.fn().mockResolvedValue({
      content: '{"done":true,"final_answer":"ok","executor_prompt":"","reason":"done","handoffs":[]}',
    }),
    run_headless: vi.fn().mockResolvedValue({
      content: "executor result",
      finish_reason: "stop",
      tool_calls: [],
      has_tool_calls: false,
      metadata: {},
    }),
  } as any;
}

/** 영원히 완료되지 않는 providers — running 상태 유지용. */
function make_hanging_providers() {
  const providers = make_providers();
  providers.run_headless = vi.fn().mockImplementation(() => new Promise(() => {}));
  providers.run_orchestrator = vi.fn().mockImplementation(() => new Promise(() => {}));
  return providers;
}

function make_registry(overrides: Record<string, unknown> = {}) {
  return new SubagentRegistry({
    workspace: "/tmp/test-subagent",
    ...overrides,
  });
}

beforeEach(() => vi.clearAllMocks());

// ══════════════════════════════════════════════════════════
// constructor
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — constructor", () => {
  it("workspace 없음 → 'workspace is required' throw", () => {
    expect(() => new SubagentRegistry({})).toThrow("workspace is required");
  });

  it("workspace 있음 → 정상 생성", () => {
    const reg = make_registry();
    expect(reg).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════
// get_agent_backends
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — get_agent_backends", () => {
  it("agent_backends=null → null 반환", () => {
    const reg = make_registry({ agent_backends: null });
    expect(reg.get_agent_backends()).toBeNull();
  });

  it("agent_backends 제공 → 그대로 반환", () => {
    const backends = { get_backend: vi.fn() } as any;
    const reg = make_registry({ agent_backends: backends });
    expect(reg.get_agent_backends()).toBe(backends);
  });
});

// ══════════════════════════════════════════════════════════
// upsert / get / list
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — upsert / get / list", () => {
  it("upsert 후 get으로 조회 + created_at 자동 설정", () => {
    const reg = make_registry();
    reg.upsert({ id: "x1", role: "worker", status: "idle" });
    const ref = reg.get("x1");
    expect(ref?.id).toBe("x1");
    expect(ref?.created_at).toBeTruthy();
  });

  it("upsert 반복 → created_at 보존, status 갱신", () => {
    const reg = make_registry();
    reg.upsert({ id: "x2", role: "worker", status: "idle", created_at: "2024-01-01T00:00:00Z" });
    const first_created = reg.get("x2")?.created_at;
    reg.upsert({ id: "x2", role: "worker", status: "running" });
    const updated = reg.get("x2");
    expect(updated?.status).toBe("running");
    expect(updated?.created_at).toBe(first_created);
  });

  it("존재하지 않는 id → get() null", () => {
    const reg = make_registry();
    expect(reg.get("not-exist")).toBeNull();
  });

  it("list() → updated_at 역순 정렬", async () => {
    const reg = make_registry();
    reg.upsert({ id: "a", role: "worker", status: "idle" });
    await new Promise(r => setTimeout(r, 10)); // 타임스탬프 차이 확보
    reg.upsert({ id: "b", role: "worker", status: "idle" });
    const items = reg.list();
    expect(items[0].id).toBe("b"); // 최신이 먼저
  });
});

// ══════════════════════════════════════════════════════════
// list_running / get_running_count (real-spawn 기반)
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — list_running / get_running_count", () => {
  it("초기 상태 → count=0, list 빈 배열", () => {
    const reg = make_registry();
    expect(reg.get_running_count()).toBe(0);
    expect(reg.list_running()).toEqual([]);
  });

  it("spawn 후 running count 증가", async () => {
    const providers = make_hanging_providers();
    const reg = make_registry({ providers });

    expect(reg.get_running_count()).toBe(0);
    await reg.spawn({ task: "t1", skip_controller: true });
    expect(reg.get_running_count()).toBe(1);
    await reg.spawn({ task: "t2", skip_controller: true });
    expect(reg.get_running_count()).toBe(2);
  });

  it("list_running() → 현재 running 항목 반환", async () => {
    const providers = make_hanging_providers();
    const reg = make_registry({ providers });

    const { subagent_id } = await reg.spawn({ task: "task", label: "TestBot", skip_controller: true });
    const running = reg.list_running();
    expect(running.find(r => r.id === subagent_id)).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════
// spawn
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — spawn", () => {
  it("providers=null → 'providers_not_configured' throw", async () => {
    const reg = make_registry({ providers: null });
    await expect(reg.spawn({ task: "task" })).rejects.toThrow("providers_not_configured");
  });

  it("running.size >= 10 → rejected 반환", async () => {
    const providers = make_hanging_providers();
    const reg = make_registry({ providers });

    // 10개 먼저 생성 (백그라운드 영원히 실행)
    for (let i = 0; i < 10; i++) {
      await reg.spawn({ task: `task-${i}`, skip_controller: true });
    }

    // 11번째 spawn → 한도 초과
    const result = await reg.spawn({ task: "overflow task" });
    expect(result.status).toBe("rejected");
    expect(result.message).toContain("concurrent subagent limit reached");
    expect(result.subagent_id).toBe("");
  });

  it("정상 spawn → status=started, subagent_id 있음", async () => {
    const providers = make_providers();
    const reg = make_registry({ providers });

    const result = await reg.spawn({ task: "build the UI", label: "UI Bot" });
    expect(result.status).toBe("started");
    expect(result.subagent_id).toBeTruthy();
    expect(result.message).toContain("UI Bot");
  });

  it("label 없으면 task 앞 40자를 label로 사용", async () => {
    const providers = make_providers();
    const reg = make_registry({ providers });
    const long_task = "a".repeat(50);
    const result = await reg.spawn({ task: long_task });
    expect(result.message).toContain("a".repeat(40));
  });
});

// ══════════════════════════════════════════════════════════
// cancel (real-spawn 기반)
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — cancel", () => {
  it("미실행 id → false 반환", () => {
    const reg = make_registry();
    expect(reg.cancel("nonexistent")).toBe(false);
  });

  it("실행 중 id → true 반환 + 상태 cancelled", async () => {
    const providers = make_hanging_providers();
    const reg = make_registry({ providers });

    const { subagent_id } = await reg.spawn({ task: "long task", skip_controller: true });
    const cancelled = reg.cancel(subagent_id);
    expect(cancelled).toBe(true);

    const ref = reg.get(subagent_id);
    expect(ref?.status).toBe("cancelled");
  });

  it("cascade=true → 자식 서브에이전트도 cancel", async () => {
    const providers = make_hanging_providers();
    const reg = make_registry({ providers });

    const parent = await reg.spawn({ task: "parent", skip_controller: true });
    const child = await reg.spawn({ task: "child", parent_id: parent.subagent_id, skip_controller: true });

    reg.cancel(parent.subagent_id, true);

    // 부모 + 자식 모두 cancelled
    expect(reg.get(parent.subagent_id)?.status).toBe("cancelled");
    expect(reg.get(child.subagent_id)?.status).toBe("cancelled");
  });

  it("cascade=false → 자식은 cancel 안 됨", async () => {
    const providers = make_hanging_providers();
    const reg = make_registry({ providers });

    const parent = await reg.spawn({ task: "parent", skip_controller: true });
    const child = await reg.spawn({ task: "child", parent_id: parent.subagent_id, skip_controller: true });

    reg.cancel(parent.subagent_id, false);

    expect(reg.get(parent.subagent_id)?.status).toBe("cancelled");
    // 자식은 아직 running 상태
    expect(reg.get(child.subagent_id)?.status).toBe("running");
  });
});

// ══════════════════════════════════════════════════════════
// cancel_by_parent_id (real-spawn 기반)
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — cancel_by_parent_id", () => {
  it("parent_id 일치하는 자식 없음 → 0 반환", () => {
    const reg = make_registry();
    expect(reg.cancel_by_parent_id("no-parent")).toBe(0);
  });

  it("parent_id 있는 자식 모두 cancel → count 반환", async () => {
    const providers = make_hanging_providers();
    const reg = make_registry({ providers });

    const parent = await reg.spawn({ task: "parent", skip_controller: true });
    await reg.spawn({ task: "child1", parent_id: parent.subagent_id, skip_controller: true });
    await reg.spawn({ task: "child2", parent_id: parent.subagent_id, skip_controller: true });

    const count = reg.cancel_by_parent_id(parent.subagent_id);
    expect(count).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════
// send_input
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — send_input", () => {
  it("없는 id → false 반환", () => {
    const reg = make_registry();
    expect(reg.send_input("missing", "hello")).toBe(false);
  });

  it("send_input 함수 없음 → false 반환", async () => {
    const providers = make_hanging_providers();
    const reg = make_registry({ providers });
    const { subagent_id } = await reg.spawn({ task: "task", skip_controller: true });
    // running에 있지만 send_input 함수 미등록 → false
    expect(reg.send_input(subagent_id, "hi")).toBe(false);
  });

  it("send_input 함수 있는 running entry → 호출 후 true", () => {
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

// ══════════════════════════════════════════════════════════
// wait_for_completion
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — wait_for_completion", () => {
  it("미존재 id → null 반환", async () => {
    const reg = make_registry();
    const result = await reg.wait_for_completion("ghost-id", 100);
    expect(result).toBeNull();
  });

  it("status=completed → { status: 'completed', content } 반환", async () => {
    const reg = make_registry();
    reg.upsert({ id: "s1", role: "worker", status: "completed", last_result: "done result" });
    const result = await reg.wait_for_completion("s1", 500);
    expect(result?.status).toBe("completed");
    expect(result?.content).toBe("done result");
  });

  it("status=failed → { status: 'failed', error } 반환", async () => {
    const reg = make_registry();
    reg.upsert({ id: "s2", role: "worker", status: "failed", last_error: "some error" });
    const result = await reg.wait_for_completion("s2", 500);
    expect(result?.status).toBe("failed");
    expect(result?.error).toBe("some error");
  });

  it("status=cancelled → { status: 'cancelled' } 반환", async () => {
    const reg = make_registry();
    reg.upsert({ id: "s3", role: "worker", status: "cancelled" });
    const result = await reg.wait_for_completion("s3", 500);
    expect(result?.status).toBe("cancelled");
  });

  it("status=offline → { status: 'offline', error } 반환", async () => {
    const reg = make_registry();
    reg.upsert({ id: "s4", role: "worker", status: "offline", last_error: "connection lost" });
    const result = await reg.wait_for_completion("s4", 500);
    expect(result?.status).toBe("offline");
    expect(result?.error).toBe("connection lost");
  });

  it("timeout 초과 → { status: 'failed', error: 'subagent_timeout_...' }", async () => {
    const reg = make_registry();
    reg.upsert({ id: "s5", role: "worker", status: "running" });
    const result = await reg.wait_for_completion("s5", 50, 20);
    expect(result?.status).toBe("failed");
    expect(result?.error).toContain("subagent_timeout_50ms");
  });
});

// ══════════════════════════════════════════════════════════
// _prune_items (500+ 항목 → Map 주입 방식, real-spawn 비현실적)
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — _prune_items", () => {
  it("500개 completed 후 501번째 upsert → 500개 이하로 정리", () => {
    const reg = make_registry();
    for (let i = 0; i < 500; i++) {
      reg.upsert({ id: `done-${i}`, role: "worker", status: "completed" });
    }
    // 501번째 추가 → _prune_items 트리거
    reg.upsert({ id: "trigger", role: "worker", status: "running" });
    const all = reg.list();
    expect(all.length).toBeLessThan(501);
  });
});

// ══════════════════════════════════════════════════════════
// _parse_controller_plan (private, 내부 파서 검증)
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — _parse_controller_plan", () => {
  it("빈 문자열 → done=false, reason='empty_controller_output'", () => {
    const reg = make_registry();
    const plan = (reg as any)._parse_controller_plan("");
    expect(plan.done).toBe(false);
    expect(plan.reason).toBe("empty_controller_output");
    expect(plan.handoffs).toEqual([]);
  });

  it("유효 JSON → 파싱된 값 반환", () => {
    const reg = make_registry();
    const json = JSON.stringify({
      done: true,
      executor_prompt: "run tests",
      final_answer: "all done",
      reason: "completed",
      handoffs: [],
    });
    const plan = (reg as any)._parse_controller_plan(json);
    expect(plan.done).toBe(true);
    expect(plan.executor_prompt).toBe("run tests");
    expect(plan.final_answer).toBe("all done");
  });

  it("비 JSON (일반 텍스트) → done=false, executor_prompt=text", () => {
    const reg = make_registry();
    const plan = (reg as any)._parse_controller_plan("just run the task");
    expect(plan.done).toBe(false);
    expect(plan.executor_prompt).toBe("just run the task");
    expect(plan.reason).toBe("non_json_controller_output");
  });

  it("handoffs: alias/instruction 없는 항목 필터링", () => {
    const reg = make_registry();
    const json = JSON.stringify({
      done: false,
      executor_prompt: "do x",
      final_answer: "",
      reason: "ongoing",
      handoffs: [
        { alias: "coder", instruction: "write code" },    // 유효
        { alias: "", instruction: "no alias" },            // alias 없음 → 필터
        { alias: "reviewer", instruction: "" },            // instruction 없음 → 필터
        { alias: "tester", instruction: "run tests" },     // 유효
      ],
    });
    const plan = (reg as any)._parse_controller_plan(json);
    expect(plan.handoffs).toHaveLength(2);
    expect(plan.handoffs[0].alias).toBe("coder");
    expect(plan.handoffs[1].alias).toBe("tester");
  });

  it("handoffs 필드 없음 → 빈 배열", () => {
    const reg = make_registry();
    const json = JSON.stringify({ done: false, executor_prompt: "x", final_answer: "", reason: "r" });
    const plan = (reg as any)._parse_controller_plan(json);
    expect(plan.handoffs).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════
// _build_controller_prompt / _build_executor_prompt (private)
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — _build_controller_prompt / _build_executor_prompt", () => {
  it("_build_controller_prompt → 'Controller mode:' + 'strict JSON only' 포함", () => {
    const reg = make_registry();
    const prompt = (reg as any)._build_controller_prompt(
      { task: "do something", role: "analyst" },
      "sub-x",
      "",
    );
    expect(prompt).toContain("Controller mode:");
    expect(prompt).toContain("strict JSON only");
  });

  it("contextual_system 있음 → '# ContextBuilder System' 포함", () => {
    const reg = make_registry();
    const prompt = (reg as any)._build_controller_prompt(
      { task: "task" },
      "sub-y",
      "You are a helpful assistant.",
    );
    expect(prompt).toContain("# ContextBuilder System");
    expect(prompt).toContain("You are a helpful assistant.");
  });

  it("_build_executor_prompt → 'Executor mode:' + 'single-turn run' 포함", () => {
    const reg = make_registry();
    const prompt = (reg as any)._build_executor_prompt(
      { task: "execute this", role: "coder" },
      "sub-z",
      "",
    );
    expect(prompt).toContain("Executor mode:");
    expect(prompt).toContain("single-turn run");
  });
});
