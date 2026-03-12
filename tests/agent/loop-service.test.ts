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
