/**
 * SubagentRegistry — spawn/cancel/wait_for_completion/_parse_controller_plan 커버리지.
 * - spawn: providers=null → throw, running >= MAX → rejected, 정상 → started
 * - cancel: 미실행 → false, 실행 중 → true + 상태 cancelled + cascade
 * - cancel_by_parent_id: parent_id 기반 일괄 cancel
 * - send_input: 없음 → false, 있음 → true
 * - wait_for_completion: timeout, completed, failed, cancelled, offline, null(미존재)
 * - _parse_controller_plan: 빈 문자열, 유효 JSON, 비 JSON, handoffs 필터링
 * - get_agent_backends: 반환값 검증
 * - upsert + _prune_items: 500개 초과 시 정리
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubagentRegistry } from "@src/agent/subagents.js";

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────

function make_providers() {
  return {
    get_orchestrator_provider_id: vi.fn().mockReturnValue("claude"),
    run_orchestrator: vi.fn().mockResolvedValue({ content: '{"done":true,"final_answer":"ok","executor_prompt":"","reason":"done","handoffs":[]}' }),
    run_headless: vi.fn().mockResolvedValue({
      content: "executor result",
      finish_reason: "stop",
      tool_calls: [],
      has_tool_calls: false,
      metadata: {},
    }),
  } as any;
}

function make_registry(overrides: Record<string, unknown> = {}) {
  return new SubagentRegistry({
    workspace: "/tmp/test-subagent",
    ...overrides,
  });
}

beforeEach(() => vi.clearAllMocks());

// ══════════════════════════════════════════════════════════
// 생성자: workspace 미제공 → throw
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
// spawn: providers=null → throw
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — spawn providers=null", () => {
  it("providers=null → 'providers_not_configured' throw", async () => {
    const reg = make_registry({ providers: null });
    await expect(reg.spawn({ task: "task" })).rejects.toThrow("providers_not_configured");
  });
});

// ══════════════════════════════════════════════════════════
// spawn: 동시 실행 한도 초과 → rejected
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — spawn concurrent limit", () => {
  it("running.size >= 10 → rejected 반환", async () => {
    const providers = make_providers();
    // run_headless가 절대 완료되지 않게 (한도 유지)
    providers.run_headless = vi.fn().mockImplementation(() => new Promise(() => {}));
    providers.run_orchestrator = vi.fn().mockImplementation(() => new Promise(() => {}));
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
});

// ══════════════════════════════════════════════════════════
// spawn: 정상 → started
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — spawn 정상", () => {
  it("정상 spawn → status=started, subagent_id 있음", async () => {
    const providers = make_providers();
    const reg = make_registry({ providers });

    const result = await reg.spawn({ task: "build the UI", label: "UI Bot" });
    expect(result.status).toBe("started");
    expect(result.subagent_id).toBeTruthy();
    expect(result.message).toContain("UI Bot");
  });

  it("label 없으면 task 앞 40자를 label로", async () => {
    const providers = make_providers();
    const reg = make_registry({ providers });
    const long_task = "a".repeat(50);
    const result = await reg.spawn({ task: long_task });
    expect(result.message).toContain("a".repeat(40));
  });
});

// ══════════════════════════════════════════════════════════
// cancel: 미실행 → false
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — cancel", () => {
  it("미실행 id → false 반환", () => {
    const reg = make_registry();
    expect(reg.cancel("nonexistent")).toBe(false);
  });

  it("실행 중 id → true 반환 + 상태 cancelled", async () => {
    const providers = make_providers();
    // 영원히 실행 중
    providers.run_headless = vi.fn().mockImplementation(() => new Promise(() => {}));
    providers.run_orchestrator = vi.fn().mockImplementation(() => new Promise(() => {}));
    const reg = make_registry({ providers });

    const { subagent_id } = await reg.spawn({ task: "long task", skip_controller: true });
    const cancelled = reg.cancel(subagent_id);
    expect(cancelled).toBe(true);

    const ref = reg.get(subagent_id);
    expect(ref?.status).toBe("cancelled");
  });

  it("cascade=true → 자식 서브에이전트도 cancel", async () => {
    const providers = make_providers();
    providers.run_headless = vi.fn().mockImplementation(() => new Promise(() => {}));
    providers.run_orchestrator = vi.fn().mockImplementation(() => new Promise(() => {}));
    const reg = make_registry({ providers });

    // 부모 생성
    const parent = await reg.spawn({ task: "parent", skip_controller: true });
    // 자식 생성 (parent_id 지정)
    const child = await reg.spawn({ task: "child", parent_id: parent.subagent_id, skip_controller: true });

    reg.cancel(parent.subagent_id, true);

    // 부모 + 자식 모두 cancelled
    expect(reg.get(parent.subagent_id)?.status).toBe("cancelled");
    expect(reg.get(child.subagent_id)?.status).toBe("cancelled");
  });

  it("cascade=false → 자식은 cancel 안 됨", async () => {
    const providers = make_providers();
    providers.run_headless = vi.fn().mockImplementation(() => new Promise(() => {}));
    providers.run_orchestrator = vi.fn().mockImplementation(() => new Promise(() => {}));
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
// cancel_by_parent_id
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — cancel_by_parent_id", () => {
  it("parent_id 있는 자식 모두 cancel → count 반환", async () => {
    const providers = make_providers();
    providers.run_headless = vi.fn().mockImplementation(() => new Promise(() => {}));
    providers.run_orchestrator = vi.fn().mockImplementation(() => new Promise(() => {}));
    const reg = make_registry({ providers });

    const parent = await reg.spawn({ task: "parent", skip_controller: true });
    await reg.spawn({ task: "child1", parent_id: parent.subagent_id, skip_controller: true });
    await reg.spawn({ task: "child2", parent_id: parent.subagent_id, skip_controller: true });

    const count = reg.cancel_by_parent_id(parent.subagent_id);
    expect(count).toBe(2);
  });

  it("parent_id 일치하는 자식 없음 → 0 반환", () => {
    const reg = make_registry();
    const count = reg.cancel_by_parent_id("no-parent");
    expect(count).toBe(0);
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
    const providers = make_providers();
    providers.run_headless = vi.fn().mockImplementation(() => new Promise(() => {}));
    const reg = make_registry({ providers });
    const { subagent_id } = await reg.spawn({ task: "task", skip_controller: true });
    // running에 있지만 send_input 함수 미등록 → false
    expect(reg.send_input(subagent_id, "hi")).toBe(false);
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

  it("status=offline → { status: 'offline' } 반환", async () => {
    const reg = make_registry();
    reg.upsert({ id: "s4", role: "worker", status: "offline" });
    const result = await reg.wait_for_completion("s4", 500);
    expect(result?.status).toBe("offline");
  });

  it("timeout 초과 → { status: 'failed', error: 'subagent_timeout_...' }", async () => {
    const reg = make_registry();
    // running 상태로 유지 (완료되지 않음)
    reg.upsert({ id: "s5", role: "worker", status: "running" });
    const result = await reg.wait_for_completion("s5", 50, 20);
    expect(result?.status).toBe("failed");
    expect(result?.error).toContain("subagent_timeout_50ms");
  });
});

// ══════════════════════════════════════════════════════════
// _parse_controller_plan
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — _parse_controller_plan (private)", () => {
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

  it("비 JSON (일반 텍스트) → done=false, executor_prompt=text, reason='non_json_controller_output'", () => {
    const reg = make_registry();
    const plan = (reg as any)._parse_controller_plan("just run the task");
    expect(plan.done).toBe(false);
    expect(plan.executor_prompt).toBe("just run the task");
    expect(plan.reason).toBe("non_json_controller_output");
  });

  it("handoffs 필드: alias/instruction 없는 항목 필터링", () => {
    const reg = make_registry();
    const json = JSON.stringify({
      done: false,
      executor_prompt: "do x",
      final_answer: "",
      reason: "ongoing",
      handoffs: [
        { alias: "coder", instruction: "write code" }, // 유효
        { alias: "", instruction: "no alias" },         // alias 없음 → 필터
        { alias: "reviewer", instruction: "" },         // instruction 없음 → 필터
        { alias: "tester", instruction: "run tests" },  // 유효
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
// upsert + _prune_items (500개 초과 시)
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — upsert + _prune_items", () => {
  it("기존 항목 없으면 새로 생성 + created_at 설정", () => {
    const reg = make_registry();
    reg.upsert({ id: "x1", role: "worker", status: "idle" });
    const ref = reg.get("x1");
    expect(ref?.id).toBe("x1");
    expect(ref?.created_at).toBeTruthy();
  });

  it("기존 항목 있으면 merge (created_at 유지)", () => {
    const reg = make_registry();
    reg.upsert({ id: "x2", role: "worker", status: "idle", created_at: "2024-01-01T00:00:00Z" });
    const first_created = reg.get("x2")?.created_at;
    reg.upsert({ id: "x2", role: "worker", status: "running" });
    const updated = reg.get("x2");
    expect(updated?.status).toBe("running");
    expect(updated?.created_at).toBe(first_created); // 유지
  });

  it("500개 초과 시 _prune_items: completed/failed/cancelled 항목 정리", () => {
    const reg = make_registry();
    // 500개 완료 항목 추가
    for (let i = 0; i < 500; i++) {
      reg.upsert({ id: `done-${i}`, role: "worker", status: "completed" });
    }
    // 501번째 추가 → _prune_items 호출
    reg.upsert({ id: "trigger", role: "worker", status: "running" });
    // items 크기가 감소했어야 함 (500 - (500-50) = 50 + 1 running)
    const all = reg.list();
    expect(all.length).toBeLessThan(501);
  });
});

// ══════════════════════════════════════════════════════════
// list / list_running / get_running_count
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — list / list_running / get_running_count", () => {
  it("list() → updated_at 역순 정렬", async () => {
    const reg = make_registry();
    reg.upsert({ id: "a", role: "worker", status: "idle" });
    await new Promise(r => setTimeout(r, 10)); // 타임스탬프 차이 확보
    reg.upsert({ id: "b", role: "worker", status: "idle" });
    const items = reg.list();
    expect(items[0].id).toBe("b"); // 최신이 먼저
  });

  it("get_running_count() → 실행 중인 서브에이전트 수", async () => {
    const providers = make_providers();
    providers.run_headless = vi.fn().mockImplementation(() => new Promise(() => {}));
    const reg = make_registry({ providers });

    expect(reg.get_running_count()).toBe(0);
    await reg.spawn({ task: "t1", skip_controller: true });
    expect(reg.get_running_count()).toBe(1);
    await reg.spawn({ task: "t2", skip_controller: true });
    expect(reg.get_running_count()).toBe(2);
  });

  it("list_running() → 현재 running 항목 반환", async () => {
    const providers = make_providers();
    providers.run_headless = vi.fn().mockImplementation(() => new Promise(() => {}));
    const reg = make_registry({ providers });

    const { subagent_id } = await reg.spawn({ task: "task", label: "TestBot", skip_controller: true });
    const running = reg.list_running();
    expect(running.find(r => r.id === subagent_id)).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════
// _build_controller_prompt / _build_executor_prompt
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — _build_controller_prompt / _build_executor_prompt (private)", () => {
  it("_build_controller_prompt → 'Controller mode:' 포함", () => {
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

  it("_build_executor_prompt → 'Executor mode:' 포함", () => {
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
