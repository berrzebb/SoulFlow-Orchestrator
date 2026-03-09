/**
 * AgentLoopStore — 미커버 경로 보충.
 * initialize / recover_orphaned_tasks / expire_stale_tasks / cancel_task /
 * resume_task / stop_loop / inject_message / drain_mailbox /
 * run_agent_loop (tool_calls / compaction_flush / abort) /
 * run_task_loop (existing task / next_step_index / result.status)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentLoopStore } from "@src/agent/loop.service.js";
import type { TaskState } from "@src/contracts.js";

// ── 헬퍼 ──────────────────────────────────────────

function make_store(overrides: ConstructorParameters<typeof AgentLoopStore>[0] = {}) {
  return new AgentLoopStore(overrides);
}

function make_providers(responses: Array<{
  content?: string;
  has_tool_calls?: boolean;
  tool_calls?: unknown[];
  usage?: { prompt_tokens: number };
}>) {
  let i = 0;
  return {
    run_headless_with_context: vi.fn(async () => {
      const r = responses[Math.min(i, responses.length - 1)]; i++;
      return {
        content: r.content ?? "ok",
        has_tool_calls: r.has_tool_calls ?? false,
        tool_calls: r.tool_calls ?? [],
        usage: r.usage,
      };
    }),
  } as any;
}

function make_task(overrides: Partial<TaskState> = {}): TaskState {
  return {
    taskId: "task:test-1",
    title: "Test",
    objective: "obj",
    channel: "slack",
    chatId: "C001",
    currentTurn: 0,
    maxTurns: 10,
    status: "running",
    currentStep: undefined,
    exitReason: undefined,
    memory: {},
    ...overrides,
  };
}

// ══════════════════════════════════════════
// initialize
// ══════════════════════════════════════════

describe("AgentLoopStore — initialize", () => {
  it("task_store 없으면 즉시 반환", async () => {
    const store = make_store();
    await expect(store.initialize()).resolves.toBeUndefined();
  });

  it("task_store.list() 결과로 tasks Map 채움", async () => {
    const task = make_task();
    const task_store = {
      list: vi.fn().mockResolvedValue([task]),
      get: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const store = make_store({ task_store: task_store as any });
    await store.initialize();
    expect(store.get_task("task:test-1")).not.toBeNull();
  });

  it("session_id 설정 없으면 orphan recovery 생략", async () => {
    const task_store = {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const store = make_store({ task_store: task_store as any });
    // session_id 설정 없이 initialize → orphan recovery 없음
    await store.initialize();
    expect(task_store.upsert).not.toHaveBeenCalled();
  });

  it("session_id 설정 후 orphan running task → task: prefix → waiting_user_input", async () => {
    const orphan = make_task({ taskId: "task:orphan", status: "running", memory: { __session_id: "old-session" } });
    const task_store = {
      list: vi.fn().mockResolvedValue([orphan]),
      get: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const store = make_store({ task_store: task_store as any });
    store.set_session_id("new-session");
    await store.initialize();
    expect(store.get_task("task:orphan")?.status).toBe("waiting_user_input");
    expect(store.get_task("task:orphan")?.exitReason).toBe("session_expired");
  });

  it("session_id 설정 후 orphan running non-task: → failed", async () => {
    const orphan = make_task({ taskId: "adhoc-orphan", status: "running", memory: { __session_id: "old-session" } });
    const task_store = {
      list: vi.fn().mockResolvedValue([orphan]),
      get: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const store = make_store({ task_store: task_store as any });
    store.set_session_id("new-session");
    await store.initialize();
    expect(store.get_task("adhoc-orphan")?.status).toBe("failed");
  });
});

// ══════════════════════════════════════════
// list_loops / get_task / list_tasks
// ══════════════════════════════════════════

describe("AgentLoopStore — list / get", () => {
  it("list_loops() — 빈 store → []", () => {
    expect(make_store().list_loops()).toEqual([]);
  });

  it("list_tasks() — 빈 store → []", () => {
    expect(make_store().list_tasks()).toEqual([]);
  });

  it("get_task() — 없는 id → null", () => {
    expect(make_store().get_task("none")).toBeNull();
  });
});

// ══════════════════════════════════════════
// stop_loop / inject_message / drain_mailbox
// ══════════════════════════════════════════

describe("AgentLoopStore — stop_loop / inject / drain", () => {
  it("stop_loop — 없는 loop_id → null", () => {
    expect(make_store().stop_loop("ghost")).toBeNull();
  });

  it("stop_loop — running 루프 → status=stopped + on_cascade_cancel 호출", async () => {
    const cancel_fn = vi.fn();
    const store = make_store({ on_cascade_cancel: cancel_fn });
    // run_agent_loop을 통해 루프 등록 후 stop
    const providers = make_providers([{ content: "ok" }]);
    let stop_called = false;
    const run_prom = store.run_agent_loop({
      loop_id: "to-stop",
      agent_id: "a1",
      objective: "test",
      context_builder: { get_messages: vi.fn().mockResolvedValue([]) } as any,
      providers,
      tools: [],
      provider_id: "test",
      max_turns: 5,
      check_should_continue: async () => {
        if (!stop_called) {
          stop_called = true;
          store.stop_loop("to-stop");
        }
        return false;
      },
    });
    await run_prom;
    expect(cancel_fn).toHaveBeenCalledWith("to-stop");
  });

  it("inject_message — 없는 loop → false", () => {
    expect(make_store().inject_message("no-loop", "msg")).toBe(false);
  });

  it("inject_message — running 루프에 메시지 주입 → true", async () => {
    const store = make_store();
    // 실행 중 루프 상태를 직접 Map에 삽입
    (store as any).loops.set("live-loop", { loopId: "live-loop", status: "running", checkShouldContinue: true });
    const r = store.inject_message("live-loop", "hello");
    expect(r).toBe(true);
  });

  it("drain_mailbox — 메시지 없으면 []", () => {
    expect(make_store().drain_mailbox("empty")).toEqual([]);
  });

  it("drain_mailbox — 메시지 있으면 반환 후 큐 비움", () => {
    const store = make_store();
    (store as any).loop_mailbox.set("q1", ["msg1", "msg2"]);
    const r = store.drain_mailbox("q1");
    expect(r).toEqual(["msg1", "msg2"]);
    expect(store.drain_mailbox("q1")).toEqual([]);
  });
});

// ══════════════════════════════════════════
// expire_stale_tasks
// ══════════════════════════════════════════

describe("AgentLoopStore — expire_stale_tasks", () => {
  it("작업 없으면 [] 반환", () => {
    expect(make_store().expire_stale_tasks()).toEqual([]);
  });

  it("waiting_approval + TTL 초과 → cancelled + 반환", () => {
    const store = make_store();
    const old_time = new Date(Date.now() - 700_000).toISOString();
    (store as any).tasks.set("stale", {
      taskId: "stale",
      status: "waiting_approval",
      memory: { __updated_at_seoul: old_time },
    });
    const expired = store.expire_stale_tasks(600_000);
    expect(expired.length).toBe(1);
    expect(store.get_task("stale")?.status).toBe("cancelled");
  });

  it("waiting_approval + TTL 미초과 → 유지", () => {
    const store = make_store();
    const recent = new Date(Date.now() - 100).toISOString();
    (store as any).tasks.set("fresh", {
      taskId: "fresh",
      status: "waiting_approval",
      memory: { __updated_at_seoul: recent },
    });
    const expired = store.expire_stale_tasks(600_000);
    expect(expired.length).toBe(0);
  });

  it("completed + TTL 초과 → Map에서 제거", () => {
    const store = make_store();
    const old_time = new Date(Date.now() - 700_000).toISOString();
    (store as any).tasks.set("done", {
      taskId: "done",
      status: "completed",
      memory: { __updated_at_seoul: old_time },
    });
    store.expire_stale_tasks(600_000);
    expect(store.get_task("done")).toBeNull();
  });

  it("stopped/failed 루프 → loops Map에서 제거", () => {
    const store = make_store();
    (store as any).loops.set("dead-loop", { loopId: "dead-loop", status: "stopped" });
    store.expire_stale_tasks();
    expect((store as any).loops.has("dead-loop")).toBe(false);
  });
});

// ══════════════════════════════════════════
// cancel_task
// ══════════════════════════════════════════

describe("AgentLoopStore — cancel_task", () => {
  it("존재하지 않는 task → null", async () => {
    const task_store = { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) };
    const store = make_store({ task_store: task_store as any });
    const r = await store.cancel_task("no-task");
    expect(r).toBeNull();
  });

  it("tasks Map에 있는 task → cancelled + on_cascade_cancel 호출", async () => {
    const cascade = vi.fn();
    const persist_fn = vi.fn().mockResolvedValue(undefined);
    const store = make_store({ on_cascade_cancel: cascade });
    (store as any).tasks.set("t1", make_task({ taskId: "t1" }));
    (store as any).persist_task = persist_fn;
    const r = await store.cancel_task("t1", "test_cancel");
    expect(r?.status).toBe("cancelled");
    expect(r?.exitReason).toBe("test_cancel");
    expect(cascade).toHaveBeenCalledWith("t1");
  });

  it("on_task_change 콜백 호출됨", async () => {
    const on_change = vi.fn();
    const store = make_store({ on_task_change: on_change });
    (store as any).tasks.set("t2", make_task({ taskId: "t2" }));
    (store as any).persist_task = vi.fn().mockResolvedValue(undefined);
    await store.cancel_task("t2");
    expect(on_change).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" }));
  });
});

// ══════════════════════════════════════════
// resume_task
// ══════════════════════════════════════════

describe("AgentLoopStore — resume_task", () => {
  it("없는 task → null", async () => {
    const task_store = { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) };
    const store = make_store({ task_store: task_store as any });
    expect(await store.resume_task("none")).toBeNull();
  });

  it("completed task → 그대로 반환 (재개 없음)", async () => {
    const store = make_store();
    (store as any).tasks.set("done", make_task({ taskId: "done", status: "completed" }));
    const r = await store.resume_task("done");
    expect(r?.status).toBe("completed");
  });

  it("waiting_user_input → running으로 전환 + user_input 저장", async () => {
    const store = make_store();
    (store as any).tasks.set("t3", make_task({ taskId: "t3", status: "waiting_user_input" }));
    (store as any).persist_task = vi.fn().mockResolvedValue(undefined);
    const r = await store.resume_task("t3", "yes please", "user_replied");
    expect(r?.status).toBe("running");
    expect(r?.memory.__user_input).toBe("yes please");
    expect(r?.exitReason).toBe("user_replied");
  });

  it("MAX_RESUME_COUNT 초과 → cancelled", async () => {
    const store = make_store();
    (store as any).tasks.set("t4", make_task({ taskId: "t4", status: "waiting_user_input", memory: { __resume_count: 3 } }));
    (store as any).persist_task = vi.fn().mockResolvedValue(undefined);
    const r = await store.resume_task("t4");
    expect(r?.status).toBe("cancelled");
    expect(r?.exitReason).toBe("max_resume_exceeded");
  });

  it("channel_context → 빈 channel/chatId 복원", async () => {
    const store = make_store();
    (store as any).tasks.set("t5", make_task({ taskId: "t5", status: "waiting_user_input", channel: "", chatId: "" }));
    (store as any).persist_task = vi.fn().mockResolvedValue(undefined);
    await store.resume_task("t5", undefined, "resumed", { channel: "telegram", chat_id: "T999" });
    const t = store.get_task("t5");
    expect(t?.channel).toBe("telegram");
    expect(t?.chatId).toBe("T999");
  });

  it("maxTurns 소진 시 resume → extend_by 계산으로 maxTurns 연장", async () => {
    const store = make_store();
    (store as any).tasks.set("t6", make_task({ taskId: "t6", status: "waiting_user_input", currentTurn: 10, maxTurns: 10, memory: {} }));
    (store as any).persist_task = vi.fn().mockResolvedValue(undefined);
    const r = await store.resume_task("t6");
    expect(r?.maxTurns).toBeGreaterThan(10);
  });
});

// ══════════════════════════════════════════
// run_agent_loop — tool_calls 경로
// ══════════════════════════════════════════

describe("AgentLoopStore.run_agent_loop — tool_calls", () => {
  it("on_tool_calls 없이 tool_calls 응답 → failed", async () => {
    const store = make_store();
    const providers = make_providers([
      { content: "needs tool", has_tool_calls: true, tool_calls: [{ name: "bash", input: {}, id: "t1" }] },
    ]);
    const result = await store.run_agent_loop({
      loop_id: "no-handler",
      agent_id: "a1",
      objective: "test",
      context_builder: { get_messages: vi.fn().mockResolvedValue([]) } as any,
      providers,
      tools: [],
      provider_id: "test",
      max_turns: 5,
    });
    expect(result.state.status).toBe("failed");
    expect(result.state.terminationReason).toBe("tool_calls_requested_but_handler_missing");
  });

  it("on_tool_calls 있음 → tool 실행 후 계속", async () => {
    const store = make_store();
    const providers = make_providers([
      { content: "tool", has_tool_calls: true, tool_calls: [{ name: "bash", input: {}, id: "t2" }] },
      { content: "final", has_tool_calls: false, tool_calls: [] },
    ]);
    const on_tool_calls = vi.fn().mockResolvedValue("tool output");
    const result = await store.run_agent_loop({
      loop_id: "with-handler",
      agent_id: "a1",
      objective: "test",
      context_builder: { get_messages: vi.fn().mockResolvedValue([]) } as any,
      providers,
      tools: [],
      provider_id: "test",
      max_turns: 5,
      on_tool_calls,
    });
    expect(on_tool_calls).toHaveBeenCalled();
  });

  it("동일 tool_call 반복 2회 초과 → guard_blocked", async () => {
    const store = make_store();
    const tool_calls = [{ name: "bash", input: { cmd: "ls" }, id: "same" }];
    const providers = make_providers([
      { content: "t", has_tool_calls: true, tool_calls },
      { content: "t", has_tool_calls: true, tool_calls },
      { content: "t", has_tool_calls: true, tool_calls },
    ]);
    const on_tool_calls = vi.fn().mockResolvedValue("ok");
    const result = await store.run_agent_loop({
      loop_id: "guard-loop",
      agent_id: "a1",
      objective: "test",
      context_builder: { get_messages: vi.fn().mockResolvedValue([]) } as any,
      providers,
      tools: [],
      provider_id: "test",
      max_turns: 10,
      on_tool_calls,
    });
    expect(result.state.status).toBe("failed");
    expect(result.state.terminationReason).toContain("repeated_tool_calls");
  });

  it("abort_signal → status=stopped, terminationReason=aborted", async () => {
    const store = make_store();
    const ctrl = new AbortController();
    ctrl.abort();
    const providers = make_providers([{ content: "ok" }]);
    const result = await store.run_agent_loop({
      loop_id: "abort-loop",
      agent_id: "a1",
      objective: "test",
      context_builder: { get_messages: vi.fn().mockResolvedValue([]) } as any,
      providers,
      tools: [],
      provider_id: "test",
      max_turns: 5,
      abort_signal: ctrl.signal,
    });
    expect(result.state.status).toBe("stopped");
    expect(result.state.terminationReason).toBe("aborted");
  });

  it("max_turns 소진 → max_turns_reached", async () => {
    const store = make_store();
    const providers = make_providers(Array(5).fill({ content: "ok" }));
    const result = await store.run_agent_loop({
      loop_id: "max-loop",
      agent_id: "a1",
      objective: "test",
      context_builder: { get_messages: vi.fn().mockResolvedValue([]) } as any,
      providers,
      tools: [],
      provider_id: "test",
      max_turns: 3,
      check_should_continue: async () => true,
    });
    expect(result.state.status).toBe("max_turns_reached");
  });

  it("compaction_flush: prompt_tokens >= trigger → flush 호출", async () => {
    const store = make_store();
    const flush = vi.fn().mockResolvedValue(undefined);
    const providers = make_providers([
      { content: "ok", usage: { prompt_tokens: 200_000 } },
      { content: "done" },
    ]);
    let n = 0;
    await store.run_agent_loop({
      loop_id: "compaction-loop",
      agent_id: "a1",
      objective: "test",
      context_builder: { get_messages: vi.fn().mockResolvedValue([]) } as any,
      providers,
      tools: [],
      provider_id: "test",
      max_turns: 5,
      compaction_flush: { context_window: 200_000, reserve_floor: 0, soft_threshold: 0, flush },
      check_should_continue: async () => { n++; return n < 2; },
    });
    expect(flush).toHaveBeenCalledOnce();
  });
});

// ══════════════════════════════════════════
// run_task_loop — 추가 경로
// ══════════════════════════════════════════

describe("AgentLoopStore.run_task_loop — 추가 경로", () => {
  it("existing task 있으면 재사용 (currentTurn 이어받음)", async () => {
    const store = make_store();
    const existing = make_task({ taskId: "resume-t", currentTurn: 3, status: "running" });
    (store as any).tasks.set("resume-t", existing);
    let turn_seen = 0;
    await store.run_task_loop({
      task_id: "resume-t",
      title: "Resume",
      objective: "obj",
      nodes: [{ id: "step1", run: async ({ task_state }) => {
        turn_seen = task_state.currentTurn;
        return { status: "completed" as const, memory_patch: {}, exit_reason: "done" };
      }}],
      max_turns: 20,
    });
    expect(turn_seen).toBe(4); // existing 3 + 1
  });

  it("result.current_step 반환 시 state.currentStep 갱신", async () => {
    const store = make_store();
    let step: string | undefined;
    await store.run_task_loop({
      task_id: "step-t",
      title: "Step",
      objective: "obj",
      nodes: [{
        id: "step1",
        run: async () => ({ current_step: "processing", status: "completed" as const, memory_patch: {}, exit_reason: "done" }),
      }],
      max_turns: 5,
      on_turn: async (s) => { step = s.currentStep; },
    });
    expect(step).toBe("processing");
  });

  it("result.next_step_index 명시 → 해당 인덱스로 이동", async () => {
    const store = make_store();
    const step2_run = vi.fn().mockResolvedValue({ status: "completed" as const, memory_patch: {}, exit_reason: "done" });
    await store.run_task_loop({
      task_id: "jump-t",
      title: "Jump",
      objective: "obj",
      nodes: [
        { id: "step1", run: async () => ({ memory_patch: {}, next_step_index: 2 }) },
        { id: "step2", run: vi.fn().mockResolvedValue({ status: "completed" as const, memory_patch: {}, exit_reason: "done" }) },
        { id: "step3", run: step2_run },
      ],
      max_turns: 5,
    });
    expect(step2_run).toHaveBeenCalled();
  });

  it("on_task_change 콜백 호출됨 (save_task_snapshot 통해)", async () => {
    const on_change = vi.fn();
    const store = make_store({ on_task_change: on_change });
    await store.run_task_loop({
      task_id: "change-t",
      title: "Change",
      objective: "obj",
      nodes: [{ id: "s1", run: async () => ({ status: "completed" as const, memory_patch: {}, exit_reason: "done" }) }],
      max_turns: 5,
    });
    expect(on_change).toHaveBeenCalled();
  });

  it("task_store 있으면 upsert 호출됨", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const task_store = { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null), upsert };
    const store = make_store({ task_store: task_store as any });
    await store.run_task_loop({
      task_id: "persist-t",
      title: "Persist",
      objective: "obj",
      nodes: [{ id: "s1", run: async () => ({ status: "completed" as const, memory_patch: {}, exit_reason: "done" }) }],
      max_turns: 5,
    });
    expect(upsert).toHaveBeenCalled();
  });

  it("waiting_approval status → 루프 중단 (TERMINAL_TASK_STATUSES)", async () => {
    const store = make_store();
    const next_run = vi.fn().mockResolvedValue({ status: "completed" as const, memory_patch: {}, exit_reason: "done" });
    const result = await store.run_task_loop({
      task_id: "wait-t",
      title: "Wait",
      objective: "obj",
      nodes: [
        { id: "s1", run: async () => ({ status: "waiting_approval" as const, memory_patch: {}, exit_reason: "needs approval" }) },
        { id: "s2", run: next_run },
      ],
      max_turns: 5,
    });
    expect(result.state.status).toBe("waiting_approval");
    expect(next_run).not.toHaveBeenCalled();
  });

  it("start_step_index >= nodes.length → 즉시 workflow_completed (L403-406)", async () => {
    // 새 task에서 start_step_index가 노드 수 이상이면 즉시 완료
    const store = make_store();
    const result = await store.run_task_loop({
      task_id: "over-idx",
      title: "Over",
      objective: "obj",
      nodes: [{ id: "n1", run: vi.fn() }, { id: "n2", run: vi.fn() }],
      max_turns: 5,
      start_step_index: 5, // 5 >= 2 nodes
    });
    expect(result.state.status).toBe("completed");
    expect(result.state.exitReason).toBe("workflow_completed");
  });

  it("next_step_index === nodes.length → L430-432 workflow_completed", async () => {
    // L430-432 커버: next_index >= options.nodes.length
    const store = make_store();
    const result = await store.run_task_loop({
      task_id: "last-step",
      title: "Last",
      objective: "obj",
      nodes: [
        { id: "n1", run: async () => ({ memory_patch: {}, next_step_index: 2 }) },
        { id: "n2", run: async () => ({ memory_patch: {}, next_step_index: 2 }) },
      ],
      max_turns: 5,
    });
    expect(result.state.status).toBe("completed");
    expect(result.state.exitReason).toBe("workflow_completed");
  });
});

// ══════════════════════════════════════════
// on_task_change throw → catch (L149, L177)
// persist_task reject → catch (L147, L175)
// ══════════════════════════════════════════

describe("AgentLoopStore — on_task_change throw → catch (오류 전파 안 됨)", () => {
  it("expire_stale_tasks: on_task_change throw → 오류 전파 안 됨 (L149)", () => {
    const on_change = vi.fn().mockImplementation(() => { throw new Error("broadcast error"); });
    const store = make_store({ on_task_change: on_change });
    const old_time = new Date(Date.now() - 700_000).toISOString();
    (store as any).tasks.set("stale", {
      taskId: "stale",
      status: "waiting_approval",
      memory: { __updated_at_seoul: old_time },
    });
    (store as any).persist_task = vi.fn().mockResolvedValue(undefined);
    // on_task_change throw가 expire_stale_tasks를 차단하면 안 됨
    expect(() => store.expire_stale_tasks(600_000)).not.toThrow();
    expect(on_change).toHaveBeenCalled();
  });

  it("cancel_task: on_task_change throw → 오류 전파 안 됨 (L177)", async () => {
    const on_change = vi.fn().mockImplementation(() => { throw new Error("change error"); });
    const store = make_store({ on_task_change: on_change });
    (store as any).tasks.set("t-throw", make_task({ taskId: "t-throw" }));
    (store as any).persist_task = vi.fn().mockResolvedValue(undefined);
    // on_task_change throw가 cancel_task를 차단하면 안 됨
    const r = await store.cancel_task("t-throw");
    expect(r?.status).toBe("cancelled");
    expect(on_change).toHaveBeenCalled();
  });

  it("expire_stale_tasks: persist_task reject → catch → logger.error 호출 (L147)", async () => {
    const err_fn = vi.fn();
    const logger = { info: vi.fn(), warn: vi.fn(), error: err_fn, debug: vi.fn() } as any;
    const store = make_store({ logger });
    const old_time = new Date(Date.now() - 700_000).toISOString();
    (store as any).tasks.set("stale2", {
      taskId: "stale2",
      status: "waiting_approval",
      memory: { __updated_at_seoul: old_time },
    });
    // persist_task reject → catch → logger.error
    (store as any).persist_task = vi.fn().mockRejectedValue(new Error("db fail"));
    store.expire_stale_tasks(600_000);
    // 비동기 reject이므로 짧게 대기
    await new Promise((r) => setTimeout(r, 20));
    expect(err_fn).toHaveBeenCalledWith("expire_stale persist failed", expect.any(Object));
  });

  it("cancel_task: persist_task reject → catch → logger.error 호출 (L175)", async () => {
    const err_fn = vi.fn();
    const logger = { info: vi.fn(), warn: vi.fn(), error: err_fn, debug: vi.fn() } as any;
    const store = make_store({ logger });
    (store as any).tasks.set("t-persist-err", make_task({ taskId: "t-persist-err" }));
    (store as any).persist_task = vi.fn().mockRejectedValue(new Error("db write fail"));
    await store.cancel_task("t-persist-err");
    await new Promise((r) => setTimeout(r, 20));
    expect(err_fn).toHaveBeenCalledWith("cancel_task persist failed", expect.any(Object));
  });
});
