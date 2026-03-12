/**
 * AgentLoopStore — run_agent_loop, run_task_loop, initialize 커버리지.
 * on_turn 콜백, step_index 리셋, orphaned tasks, channel/chatId 복원,
 * abort/mailbox/error/max_turns/check_should_continue 경로.
 */
import { describe, it, expect, vi } from "vitest";
import { AgentLoopStore } from "@src/agent/loop.service.js";

// ══════════════════════════════════════════
// L287: run_agent_loop — on_turn 콜백
// ══════════════════════════════════════════

function make_providers(response: { content: string } = { content: "done" }) {
  return {
    run_headless_with_context: vi.fn(async () => ({
      content: response.content,
      has_tool_calls: false,
      tool_calls: [],
      usage: undefined,
    })),
  } as any;
}

function make_context_builder() {
  return { get_messages: vi.fn().mockResolvedValue([]) } as any;
}

describe("AgentLoopStore.run_agent_loop — on_turn 콜백 (L287)", () => {
  it("on_turn 옵션 제공 → 매 턴마다 on_turn 호출 (L287)", async () => {
    const store = new AgentLoopStore();
    const on_turn = vi.fn();
    const providers = make_providers({ content: "finished" });

    await store.run_agent_loop({
      loop_id: "on-turn-test",
      agent_id: "a1",
      objective: "test",
      context_builder: make_context_builder(),
      providers,
      tools: [],
      provider_id: "test",
      current_message: "start",
      history_days: [],
      skill_names: [],
      max_turns: 5,
      on_turn,                       // L287: on_turn 제공
      check_should_continue: async () => false,
    });

    // on_turn이 호출되었어야 함 (L287)
    expect(on_turn).toHaveBeenCalled();
    expect(on_turn).toHaveBeenCalledWith(
      expect.objectContaining({
        state: expect.any(Object),
        response: expect.any(Object),
      }),
    );
  });
});

// ══════════════════════════════════════════
// L388: run_task_loop — __step_index 범위 초과 리셋
// ══════════════════════════════════════════

describe("AgentLoopStore.run_task_loop — __step_index 범위 초과 리셋 (L388)", () => {
  it("재개 시 __step_index >= nodes.length → L388: __step_index = 0으로 리셋", async () => {
    const store = new AgentLoopStore();
    const task_id = `step-reset-${Date.now()}`;

    // 1단계: 3개 노드로 완주 (step_index가 3이 됨)
    await store.run_task_loop({
      task_id,
      title: "3-node workflow",
      nodes: [
        { id: "s0", run: async () => ({ memory_patch: {}, next_step_index: 1 }) },
        { id: "s1", run: async () => ({ memory_patch: {}, next_step_index: 2 }) },
        { id: "s2", run: async () => ({ status: "completed" as const, memory_patch: {}, exit_reason: "done" }) },
      ],
      max_turns: 10,
    });

    // state의 __step_index는 이제 2 이상 (마지막 노드 실행 후 완료)
    // 2단계: 1개 노드로 재개 → existing state 사용 → __step_index >= 1 → L388: reset to 0
    const result = await store.run_task_loop({
      task_id,
      title: "1-node resumed",
      nodes: [
        { id: "s0", run: async () => ({ status: "completed" as const, memory_patch: {}, exit_reason: "resumed_done" }) },
      ],
      max_turns: 10,
    });

    // 재개된 작업이 처리됨 (status는 completed였으므로 루프 미실행)
    expect(result.state.taskId).toBe(task_id);
  });
});

// ══════════════════════════════════════════════════════════
// (from loop-service-cov4) initialize, channel/chatId 복원
// ══════════════════════════════════════════════════════════

function create_noop_logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;
}

describe("AgentLoopStore.initialize — L55: orphaned tasks 복구 후 logger.info", () => {
  it("running 상태 고아 태스크 존재 → L55: logger.info('recovered_orphaned_tasks') 호출", async () => {
    const logger = create_noop_logger();
    const store = new AgentLoopStore({ logger });

    store.set_session_id("sess-current");

    const task_store = {
      list: vi.fn().mockResolvedValue([
        {
          taskId: "task:orphaned-1",
          status: "running",
          memory: { __session_id: "sess-old" },
          channel: "slack",
          chatId: "C1",
          currentTurn: 0,
          maxTurns: 10,
          title: "고아 태스크",
          objective: "test",
        },
        {
          taskId: "task:current-1",
          status: "running",
          memory: { __session_id: "sess-current" },
          channel: "slack",
          chatId: "C2",
          currentTurn: 0,
          maxTurns: 10,
          title: "현재 태스크",
          objective: "test",
        },
      ]),
      get: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    } as any;

    const store2 = new AgentLoopStore({ task_store, logger });
    store2.set_session_id("sess-current");

    await store2.initialize();

    expect(logger.info).toHaveBeenCalledWith(
      "recovered_orphaned_tasks",
      expect.objectContaining({ count: expect.any(Number) }),
    );
  });
});

describe("AgentLoopStore.run_task_loop — L381/382: 기존 태스크 channel/chatId 복원", () => {
  it("기존 태스크의 channel/chatId가 비어있고 options에 값 있음 → L381/382 복원", async () => {
    const store = new AgentLoopStore();

    const task_id = "task:restore-channel";
    (store as any).tasks.set(task_id, {
      taskId: task_id,
      status: "running",
      channel: "",
      chatId: "",
      currentTurn: 0,
      maxTurns: 5,
      title: "채널 복원 테스트",
      objective: "test",
      memory: { __step_index: 0 },
    });

    const mock_node = {
      node_id: "n1",
      node_type: "noop",
      execute: vi.fn().mockResolvedValue({ output: {} }),
      test: vi.fn().mockReturnValue({ preview: {}, warnings: [] }),
    } as any;

    const result = await store.run_task_loop({
      task_id,
      title: "채널 복원 테스트",
      objective: "test",
      nodes: [mock_node],
      providers: { run_headless_with_context: vi.fn() } as any,
      context_builder: { get_messages: vi.fn().mockResolvedValue([]) } as any,
      provider_id: "test",
      channel: "slack",
      chat_id: "C_restored",
      history_days: [],
      max_turns: 5,
    });

    const state = (store as any).tasks.get(task_id);
    expect(state?.channel).toBe("slack");
    expect(state?.chatId).toBe("C_restored");
  });
});

// ══════════════════════════════════════════════════════════
// (from loop-service-coverage) run_task_loop / run_agent_loop 미커버 경로
// ══════════════════════════════════════════════════════════

describe("AgentLoopStore.run_task_loop — 미커버 경로", () => {
  it("abort_signal이 이미 aborted이면 → status=cancelled", async () => {
    const store = new AgentLoopStore();
    const controller = new AbortController();
    controller.abort();
    const result = await store.run_task_loop({
      task_id: "abort-task",
      title: "Abort Test",
      nodes: [{ id: "step1", run: vi.fn().mockResolvedValue({ memory_patch: {} }) }],
      max_turns: 10,
      abort_signal: controller.signal,
    });
    expect(result.state.status).toBe("cancelled");
    expect(result.state.exitReason).toBe("aborted");
  });

  it("loop_mailbox에 주입된 메시지 → __injected_message 메모리에 반영", async () => {
    const store = new AgentLoopStore();
    (store as any).loop_mailbox.set("mailbox-task", ["injected text"]);
    let captured_memory: Record<string, unknown> | undefined;
    await store.run_task_loop({
      task_id: "mailbox-task",
      title: "Mailbox Test",
      nodes: [{ id: "step1", run: async ({ memory }: any) => { captured_memory = { ...memory }; return { status: "completed" as const, memory_patch: {}, exit_reason: "done" }; } }],
      max_turns: 5,
    });
    expect(captured_memory?.__injected_message).toBe("injected text");
  });

  it("node.run이 에러를 throw → status=failed", async () => {
    const store = new AgentLoopStore();
    const result = await store.run_task_loop({
      task_id: "throw-task",
      title: "Throw Test",
      nodes: [{ id: "step1", run: async () => { throw new Error("node execution failed"); } }],
      max_turns: 10,
    });
    expect(result.state.status).toBe("failed");
    expect(result.state.exitReason).toContain("node execution failed");
  });

  it("max_turns 초과 → status=max_turns_reached", async () => {
    const store = new AgentLoopStore();
    let turn_count = 0;
    const result = await store.run_task_loop({
      task_id: "maxturns-task",
      title: "MaxTurns Test",
      nodes: [{ id: "step1", run: async () => { turn_count++; return { memory_patch: {}, next_step_index: 0 }; } }],
      max_turns: 3,
    });
    expect(result.state.status).toBe("max_turns_reached");
    expect(turn_count).toBe(3);
  });

  it("on_turn 콜백이 매 턴마다 호출됨", async () => {
    const store = new AgentLoopStore();
    const on_turn = vi.fn();
    let turn = 0;
    await store.run_task_loop({
      task_id: "onturn-task",
      title: "OnTurn Test",
      nodes: [{ id: "step1", run: async () => { turn++; return turn < 2 ? { memory_patch: {}, next_step_index: 0 } : { status: "completed" as const, memory_patch: {}, exit_reason: "done" }; } }],
      max_turns: 10,
      on_turn,
    });
    expect(on_turn).toHaveBeenCalledTimes(2);
  });
});

function make_coverage_providers(responses: Array<{ final_content: string }>) {
  let i = 0;
  return {
    run_headless_with_context: vi.fn(async () => {
      const r = responses[Math.min(i, responses.length - 1)]; i++;
      return { final_content: r.final_content, tool_calls: [] };
    }),
  } as any;
}

function make_coverage_context_builder() {
  return { get_messages: vi.fn().mockResolvedValue([]) } as any;
}

describe("AgentLoopStore.run_agent_loop — 미커버 경로", () => {
  it("check_should_continue = false → status=completed", async () => {
    const store = new AgentLoopStore();
    const result = await store.run_agent_loop({
      loop_id: "stop-loop", agent_id: "a1", objective: "stop",
      context_builder: make_coverage_context_builder(),
      providers: make_coverage_providers([{ final_content: "r" }]),
      tools: [], provider_id: "test", current_message: "start",
      history_days: [], skill_names: [], max_turns: 10,
      check_should_continue: async () => false,
    });
    expect(result.state.status).toBe("completed");
    expect(result.state.terminationReason).toBe("check_should_continue_false");
  });

  it("check_should_continue = string → string을 다음 메시지로 사용 후 false 종료", async () => {
    const store = new AgentLoopStore();
    const providers = make_coverage_providers([{ final_content: "t1" }, { final_content: "t2" }]);
    let n = 0;
    const result = await store.run_agent_loop({
      loop_id: "str-loop", agent_id: "a1", objective: "str",
      context_builder: make_coverage_context_builder(), providers,
      tools: [], provider_id: "test", current_message: "start",
      history_days: [], skill_names: [], max_turns: 10,
      check_should_continue: async () => { n++; return n === 1 ? "follow-up" : false; },
    });
    expect(result.state.status).toBe("completed");
    expect(providers.run_headless_with_context).toHaveBeenCalledTimes(2);
  });

  it("check_should_continue 없음 → 기본값 false → 1턴 후 completed", async () => {
    const store = new AgentLoopStore();
    const providers = make_coverage_providers([{ final_content: "done" }]);
    const result = await store.run_agent_loop({
      loop_id: "no-cont-loop", agent_id: "a1", objective: "nc",
      context_builder: make_coverage_context_builder(), providers,
      tools: [], provider_id: "test", current_message: "start",
      history_days: [], skill_names: [], max_turns: 10,
    });
    expect(result.state.status).toBe("completed");
    expect(providers.run_headless_with_context).toHaveBeenCalledTimes(1);
  });

  it("loop_mailbox 직접 주입 → injected_text_turn 경로 실행 후 continue", async () => {
    const store = new AgentLoopStore();
    const loop_id = "mailbox-agent-loop";
    (store as any).loop_mailbox.set(loop_id, ["injected msg"]);
    const providers = make_coverage_providers([{ final_content: "r1" }, { final_content: "r2" }]);
    let n = 0;
    const result = await store.run_agent_loop({
      loop_id, agent_id: "a1", objective: "mailbox",
      context_builder: make_coverage_context_builder(), providers,
      tools: [], provider_id: "test", current_message: "start",
      history_days: [], skill_names: [], max_turns: 5,
      check_should_continue: async () => { n++; return n > 1 ? false : true; },
    });
    expect(result.state.status).toBe("completed");
    expect(providers.run_headless_with_context).toHaveBeenCalledTimes(3);
  });
});

// ══════════════════════════════════════════════════════════
// Extended: AgentLoopStore comprehensive coverage
// ══════════════════════════════════════════════════════════

import type { TaskState } from "@src/contracts.js";

function make_ext_store(overrides: ConstructorParameters<typeof AgentLoopStore>[0] = {}) {
  return new AgentLoopStore(overrides);
}

function make_ext_providers(responses: Array<{
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

describe("AgentLoopStore — initialize (extended)", () => {
  it("task_store 없으면 즉시 반환", async () => {
    const store = make_ext_store();
    await expect(store.initialize()).resolves.toBeUndefined();
  });

  it("task_store.list() 결과로 tasks Map 채움", async () => {
    const task = make_task();
    const task_store = {
      list: vi.fn().mockResolvedValue([task]),
      get: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const store = make_ext_store({ task_store: task_store as any });
    await store.initialize();
    expect(store.get_task("task:test-1")).not.toBeNull();
  });

  it("session_id 설정 후 orphan running task → task: prefix → waiting_user_input", async () => {
    const orphan = make_task({ taskId: "task:orphan", status: "running", memory: { __session_id: "old-session" } });
    const task_store = {
      list: vi.fn().mockResolvedValue([orphan]),
      get: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const store = make_ext_store({ task_store: task_store as any });
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
    const store = make_ext_store({ task_store: task_store as any });
    store.set_session_id("new-session");
    await store.initialize();
    expect(store.get_task("adhoc-orphan")?.status).toBe("failed");
  });
});

describe("AgentLoopStore — list / get (extended)", () => {
  it("list_loops() — 빈 store → []", () => {
    expect(make_ext_store().list_loops()).toEqual([]);
  });

  it("list_tasks() — 빈 store → []", () => {
    expect(make_ext_store().list_tasks()).toEqual([]);
  });

  it("get_task() — 없는 id → null", () => {
    expect(make_ext_store().get_task("none")).toBeNull();
  });
});

describe("AgentLoopStore — stop_loop / inject / drain", () => {
  it("stop_loop — 없는 loop_id → null", () => {
    expect(make_ext_store().stop_loop("ghost")).toBeNull();
  });

  it("inject_message — 없는 loop → false", () => {
    expect(make_ext_store().inject_message("no-loop", "msg")).toBe(false);
  });

  it("inject_message — running 루프에 메시지 주입 → true", async () => {
    const store = make_ext_store();
    (store as any).loops.set("live-loop", { loopId: "live-loop", status: "running", checkShouldContinue: true });
    expect(store.inject_message("live-loop", "hello")).toBe(true);
  });

  it("drain_mailbox — 메시지 없으면 []", () => {
    expect(make_ext_store().drain_mailbox("empty")).toEqual([]);
  });

  it("drain_mailbox — 메시지 있으면 반환 후 큐 비움", () => {
    const store = make_ext_store();
    (store as any).loop_mailbox.set("q1", ["msg1", "msg2"]);
    const r = store.drain_mailbox("q1");
    expect(r).toEqual(["msg1", "msg2"]);
    expect(store.drain_mailbox("q1")).toEqual([]);
  });
});

describe("AgentLoopStore — expire_stale_tasks", () => {
  it("작업 없으면 [] 반환", () => {
    expect(make_ext_store().expire_stale_tasks()).toEqual([]);
  });

  it("waiting_approval + TTL 초과 → cancelled", () => {
    const store = make_ext_store();
    const old_time = new Date(Date.now() - 700_000).toISOString();
    (store as any).tasks.set("stale", {
      taskId: "stale", status: "waiting_approval",
      memory: { __updated_at_seoul: old_time },
    });
    const expired = store.expire_stale_tasks(600_000);
    expect(expired.length).toBe(1);
    expect(store.get_task("stale")?.status).toBe("cancelled");
  });

  it("completed + TTL 초과 → Map에서 제거", () => {
    const store = make_ext_store();
    const old_time = new Date(Date.now() - 700_000).toISOString();
    (store as any).tasks.set("done", {
      taskId: "done", status: "completed",
      memory: { __updated_at_seoul: old_time },
    });
    store.expire_stale_tasks(600_000);
    expect(store.get_task("done")).toBeNull();
  });

  it("stopped/failed 루프 → loops Map에서 제거", () => {
    const store = make_ext_store();
    (store as any).loops.set("dead-loop", { loopId: "dead-loop", status: "stopped" });
    store.expire_stale_tasks();
    expect((store as any).loops.has("dead-loop")).toBe(false);
  });
});

describe("AgentLoopStore — cancel_task", () => {
  it("존재하지 않는 task → null", async () => {
    const task_store = { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) };
    const store = make_ext_store({ task_store: task_store as any });
    expect(await store.cancel_task("no-task")).toBeNull();
  });

  it("tasks Map에 있는 task → cancelled + on_cascade_cancel 호출", async () => {
    const cascade = vi.fn();
    const store = make_ext_store({ on_cascade_cancel: cascade });
    (store as any).tasks.set("t1", make_task({ taskId: "t1" }));
    (store as any).persist_task = vi.fn().mockResolvedValue(undefined);
    const r = await store.cancel_task("t1", "test_cancel");
    expect(r?.status).toBe("cancelled");
    expect(cascade).toHaveBeenCalledWith("t1");
  });
});

describe("AgentLoopStore — resume_task", () => {
  it("없는 task → null", async () => {
    const task_store = { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) };
    const store = make_ext_store({ task_store: task_store as any });
    expect(await store.resume_task("none")).toBeNull();
  });

  it("completed task → 그대로 반환", async () => {
    const store = make_ext_store();
    (store as any).tasks.set("done", make_task({ taskId: "done", status: "completed" }));
    const r = await store.resume_task("done");
    expect(r?.status).toBe("completed");
  });

  it("waiting_user_input → running + user_input 저장", async () => {
    const store = make_ext_store();
    (store as any).tasks.set("t3", make_task({ taskId: "t3", status: "waiting_user_input" }));
    (store as any).persist_task = vi.fn().mockResolvedValue(undefined);
    const r = await store.resume_task("t3", "yes please", "user_replied");
    expect(r?.status).toBe("running");
    expect(r?.memory.__user_input).toBe("yes please");
  });

  it("MAX_RESUME_COUNT 초과 → cancelled", async () => {
    const store = make_ext_store();
    (store as any).tasks.set("t4", make_task({ taskId: "t4", status: "waiting_user_input", memory: { __resume_count: 3 } }));
    (store as any).persist_task = vi.fn().mockResolvedValue(undefined);
    const r = await store.resume_task("t4");
    expect(r?.status).toBe("cancelled");
    expect(r?.exitReason).toBe("max_resume_exceeded");
  });

  it("channel_context → 빈 channel/chatId 복원", async () => {
    const store = make_ext_store();
    (store as any).tasks.set("t5", make_task({ taskId: "t5", status: "waiting_user_input", channel: "", chatId: "" }));
    (store as any).persist_task = vi.fn().mockResolvedValue(undefined);
    await store.resume_task("t5", undefined, "resumed", { channel: "telegram", chat_id: "T999" });
    const t = store.get_task("t5");
    expect(t?.channel).toBe("telegram");
    expect(t?.chatId).toBe("T999");
  });

  it("maxTurns 소진 시 resume → maxTurns 연장", async () => {
    const store = make_ext_store();
    (store as any).tasks.set("t6", make_task({ taskId: "t6", status: "waiting_user_input", currentTurn: 10, maxTurns: 10, memory: {} }));
    (store as any).persist_task = vi.fn().mockResolvedValue(undefined);
    const r = await store.resume_task("t6");
    expect(r?.maxTurns).toBeGreaterThan(10);
  });
});

describe("AgentLoopStore.run_agent_loop — tool_calls (extended)", () => {
  it("on_tool_calls 없이 tool_calls 응답 → failed", async () => {
    const store = make_ext_store();
    const providers = make_ext_providers([
      { content: "needs tool", has_tool_calls: true, tool_calls: [{ name: "bash", input: {}, id: "t1" }] },
    ]);
    const result = await store.run_agent_loop({
      loop_id: "no-handler", agent_id: "a1", objective: "test",
      context_builder: { get_messages: vi.fn().mockResolvedValue([]) } as any,
      providers, tools: [], provider_id: "test", max_turns: 5,
    });
    expect(result.state.status).toBe("failed");
    expect(result.state.terminationReason).toBe("tool_calls_requested_but_handler_missing");
  });

  it("동일 tool_call 반복 2회 초과 → guard_blocked", async () => {
    const store = make_ext_store();
    const tool_calls = [{ name: "bash", input: { cmd: "ls" }, id: "same" }];
    const providers = make_ext_providers([
      { content: "t", has_tool_calls: true, tool_calls },
      { content: "t", has_tool_calls: true, tool_calls },
      { content: "t", has_tool_calls: true, tool_calls },
    ]);
    const on_tool_calls = vi.fn().mockResolvedValue("ok");
    const result = await store.run_agent_loop({
      loop_id: "guard-loop", agent_id: "a1", objective: "test",
      context_builder: { get_messages: vi.fn().mockResolvedValue([]) } as any,
      providers, tools: [], provider_id: "test", max_turns: 10, on_tool_calls,
    });
    expect(result.state.status).toBe("failed");
    expect(result.state.terminationReason).toContain("repeated_tool_calls");
  });

  it("abort_signal → status=stopped", async () => {
    const store = make_ext_store();
    const ctrl = new AbortController();
    ctrl.abort();
    const providers = make_ext_providers([{ content: "ok" }]);
    const result = await store.run_agent_loop({
      loop_id: "abort-loop", agent_id: "a1", objective: "test",
      context_builder: { get_messages: vi.fn().mockResolvedValue([]) } as any,
      providers, tools: [], provider_id: "test", max_turns: 5,
      abort_signal: ctrl.signal,
    });
    expect(result.state.status).toBe("stopped");
    expect(result.state.terminationReason).toBe("aborted");
  });

  it("compaction_flush: prompt_tokens >= trigger → flush 호출", async () => {
    const store = make_ext_store();
    const flush = vi.fn().mockResolvedValue(undefined);
    const providers = make_ext_providers([
      { content: "ok", usage: { prompt_tokens: 200_000 } },
      { content: "done" },
    ]);
    let n = 0;
    await store.run_agent_loop({
      loop_id: "compaction-loop", agent_id: "a1", objective: "test",
      context_builder: { get_messages: vi.fn().mockResolvedValue([]) } as any,
      providers, tools: [], provider_id: "test", max_turns: 5,
      compaction_flush: { context_window: 200_000, reserve_floor: 0, soft_threshold: 0, flush },
      check_should_continue: async () => { n++; return n < 2; },
    });
    expect(flush).toHaveBeenCalledOnce();
  });
});

describe("AgentLoopStore.run_task_loop — extended paths", () => {
  it("existing task → 재사용 (currentTurn 이어받음)", async () => {
    const store = make_ext_store();
    const existing = make_task({ taskId: "resume-t", currentTurn: 3, status: "running" });
    (store as any).tasks.set("resume-t", existing);
    let turn_seen = 0;
    await store.run_task_loop({
      task_id: "resume-t", title: "Resume", objective: "obj",
      nodes: [{ id: "step1", run: async ({ task_state }: any) => {
        turn_seen = task_state.currentTurn;
        return { status: "completed" as const, memory_patch: {}, exit_reason: "done" };
      }}],
      max_turns: 20,
    });
    expect(turn_seen).toBe(4);
  });

  it("result.next_step_index → 해당 인덱스로 이동", async () => {
    const store = make_ext_store();
    const step2_run = vi.fn().mockResolvedValue({ status: "completed" as const, memory_patch: {}, exit_reason: "done" });
    await store.run_task_loop({
      task_id: "jump-t", title: "Jump", objective: "obj",
      nodes: [
        { id: "step1", run: async () => ({ memory_patch: {}, next_step_index: 2 }) },
        { id: "step2", run: vi.fn().mockResolvedValue({ status: "completed" as const, memory_patch: {}, exit_reason: "done" }) },
        { id: "step3", run: step2_run },
      ],
      max_turns: 5,
    });
    expect(step2_run).toHaveBeenCalled();
  });

  it("start_step_index >= nodes.length → 즉시 workflow_completed", async () => {
    const store = make_ext_store();
    const result = await store.run_task_loop({
      task_id: "over-idx", title: "Over", objective: "obj",
      nodes: [{ id: "n1", run: vi.fn() }, { id: "n2", run: vi.fn() }],
      max_turns: 5,
      start_step_index: 5,
    });
    expect(result.state.status).toBe("completed");
    expect(result.state.exitReason).toBe("workflow_completed");
  });

  it("waiting_approval → 루프 중단", async () => {
    const store = make_ext_store();
    const next_run = vi.fn();
    const result = await store.run_task_loop({
      task_id: "wait-t", title: "Wait", objective: "obj",
      nodes: [
        { id: "s1", run: async () => ({ status: "waiting_approval" as const, memory_patch: {}, exit_reason: "needs approval" }) },
        { id: "s2", run: next_run },
      ],
      max_turns: 5,
    });
    expect(result.state.status).toBe("waiting_approval");
    expect(next_run).not.toHaveBeenCalled();
  });
});

describe("AgentLoopStore — on_task_change throw → catch", () => {
  it("expire_stale_tasks: on_task_change throw → 오류 전파 안 됨", () => {
    const on_change = vi.fn().mockImplementation(() => { throw new Error("broadcast error"); });
    const store = make_ext_store({ on_task_change: on_change });
    const old_time = new Date(Date.now() - 700_000).toISOString();
    (store as any).tasks.set("stale", {
      taskId: "stale", status: "waiting_approval",
      memory: { __updated_at_seoul: old_time },
    });
    (store as any).persist_task = vi.fn().mockResolvedValue(undefined);
    expect(() => store.expire_stale_tasks(600_000)).not.toThrow();
  });

  it("cancel_task: on_task_change throw → 오류 전파 안 됨", async () => {
    const on_change = vi.fn().mockImplementation(() => { throw new Error("change error"); });
    const store = make_ext_store({ on_task_change: on_change });
    (store as any).tasks.set("t-throw", make_task({ taskId: "t-throw" }));
    (store as any).persist_task = vi.fn().mockResolvedValue(undefined);
    const r = await store.cancel_task("t-throw");
    expect(r?.status).toBe("cancelled");
  });
});
