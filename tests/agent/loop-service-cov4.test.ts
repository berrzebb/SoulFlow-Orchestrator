/**
 * AgentLoopStore — 미커버 분기 (cov4):
 * - L55: initialize — orphaned tasks 복구 시 logger.info 호출
 * - L65: recover_orphaned_tasks — task_session === session_id → continue
 * - L381: run_task_loop — 기존 태스크 channel 복원 (빈 channel + options.channel)
 * - L382: run_task_loop — 기존 태스크 chatId 복원 (빈 chatId + options.chat_id)
 */
import { describe, it, expect, vi } from "vitest";
import { AgentLoopStore } from "@src/agent/loop.service.js";

function create_noop_logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;
}

// ── L55 & L65: initialize — orphaned task 복구 + session_id 일치 분기 ─────────

describe("AgentLoopStore.initialize — L55: orphaned tasks 복구 후 logger.info", () => {
  it("running 상태 고아 태스크 존재 → L55: logger.info('recovered_orphaned_tasks') 호출", async () => {
    const logger = create_noop_logger();
    const store = new AgentLoopStore({ logger });

    // session_id를 "sess-current"로 설정
    store.set_session_id("sess-current");

    // task_store에 두 개의 running 태스크 주입 (하나는 다른 세션, 하나는 현재 세션)
    const task_store = {
      list: vi.fn().mockResolvedValue([
        {
          taskId: "task:orphaned-1",
          status: "running",
          memory: { __session_id: "sess-old" },  // 다른 세션 → 고아
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
          memory: { __session_id: "sess-current" },  // 현재 세션 → L65 continue
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

    // L55: orphaned task가 있으면 logger.info 호출
    expect(logger.info).toHaveBeenCalledWith(
      "recovered_orphaned_tasks",
      expect.objectContaining({ count: expect.any(Number) }),
    );
  });
});

// ── L381/382: run_task_loop — 기존 태스크 channel/chatId 복원 ─────────────────

describe("AgentLoopStore.run_task_loop — L381/382: 기존 태스크 channel/chatId 복원", () => {
  it("기존 태스크의 channel/chatId가 비어있고 options에 값 있음 → L381/382 복원", async () => {
    const store = new AgentLoopStore();

    // 기존 태스크를 channel/chatId 없이 저장
    const task_id = "task:restore-channel";
    (store as any).tasks.set(task_id, {
      taskId: task_id,
      status: "running",
      channel: "",       // 빈 값 → L381 복원 대상
      chatId: "",        // 빈 값 → L382 복원 대상
      currentTurn: 0,
      maxTurns: 5,
      title: "채널 복원 테스트",
      objective: "test",
      memory: { __step_index: 0 },
    });

    // 각 노드의 execute를 모킹 (즉시 완료)
    const mock_node = {
      node_id: "n1",
      node_type: "noop",
      execute: vi.fn().mockResolvedValue({ output: {} }),
      test: vi.fn().mockReturnValue({ preview: {}, warnings: [] }),
    } as any;

    // run_task_loop 실행 — options에 channel/chat_id 설정
    const result = await store.run_task_loop({
      task_id,
      title: "채널 복원 테스트",
      objective: "test",
      nodes: [mock_node],
      providers: { run_headless_with_context: vi.fn() } as any,
      context_builder: { get_messages: vi.fn().mockResolvedValue([]) } as any,
      provider_id: "test",
      channel: "slack",        // L381 복원 값
      chat_id: "C_restored",  // L382 복원 값
      history_days: [],
      max_turns: 5,
    });

    // channel/chatId가 복원되었는지 확인
    const state = (store as any).tasks.get(task_id);
    expect(state?.channel).toBe("slack");
    expect(state?.chatId).toBe("C_restored");
  });
});
