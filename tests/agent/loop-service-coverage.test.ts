import { describe, it, expect, vi } from "vitest";
import { AgentLoopStore } from "@src/agent/loop.service.js";

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

function make_providers(responses: Array<{ final_content: string }>) {
  let i = 0;
  return {
    run_headless_with_context: vi.fn(async () => {
      const r = responses[Math.min(i, responses.length - 1)]; i++;
      return { final_content: r.final_content, tool_calls: [] };
    }),
  } as any;
}

function make_context_builder() {
  return { get_messages: vi.fn().mockResolvedValue([]) } as any;
}

describe("AgentLoopStore.run_agent_loop — 미커버 경로", () => {
  it("check_should_continue = false → status=completed", async () => {
    const store = new AgentLoopStore();
    const result = await store.run_agent_loop({
      loop_id: "stop-loop", agent_id: "a1", objective: "stop",
      context_builder: make_context_builder(),
      providers: make_providers([{ final_content: "r" }]),
      tools: [], provider_id: "test", current_message: "start",
      history_days: [], skill_names: [], max_turns: 10,
      check_should_continue: async () => false,
    });
    expect(result.state.status).toBe("completed");
    expect(result.state.terminationReason).toBe("check_should_continue_false");
  });

  it("check_should_continue = string → string을 다음 메시지로 사용 후 false 종료", async () => {
    const store = new AgentLoopStore();
    const providers = make_providers([{ final_content: "t1" }, { final_content: "t2" }]);
    let n = 0;
    const result = await store.run_agent_loop({
      loop_id: "str-loop", agent_id: "a1", objective: "str",
      context_builder: make_context_builder(), providers,
      tools: [], provider_id: "test", current_message: "start",
      history_days: [], skill_names: [], max_turns: 10,
      check_should_continue: async () => { n++; return n === 1 ? "follow-up" : false; },
    });
    expect(result.state.status).toBe("completed");
    expect(providers.run_headless_with_context).toHaveBeenCalledTimes(2);
  });

  it("check_should_continue 없음 → 기본값 false → 1턴 후 completed", async () => {
    const store = new AgentLoopStore();
    const providers = make_providers([{ final_content: "done" }]);
    const result = await store.run_agent_loop({
      loop_id: "no-cont-loop", agent_id: "a1", objective: "nc",
      context_builder: make_context_builder(), providers,
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
    const providers = make_providers([{ final_content: "r1" }, { final_content: "r2" }]);
    let n = 0;
    const result = await store.run_agent_loop({
      loop_id, agent_id: "a1", objective: "mailbox",
      context_builder: make_context_builder(), providers,
      tools: [], provider_id: "test", current_message: "start",
      history_days: [], skill_names: [], max_turns: 5,
      check_should_continue: async () => { n++; return n > 1 ? false : true; },
    });
    expect(result.state.status).toBe("completed");
    // 첫 턴: mailbox 소비 후 continue (check 미호출), 두번째 턴: check=true, 세번째: check=false
    expect(providers.run_headless_with_context).toHaveBeenCalledTimes(3);
  });
});
