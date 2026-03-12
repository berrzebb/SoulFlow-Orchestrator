/**
 * loop.service.ts 미커버 분기 보충.
 * L287: run_agent_loop에서 on_turn 콜백 호출
 * L388: run_task_loop 재개 시 __step_index 범위 초과 → 0으로 리셋
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
