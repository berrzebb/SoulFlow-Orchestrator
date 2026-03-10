/**
 * KanbanTriggerWatcher — 전체 커버리지:
 * - setup: waiting 워크플로우 스캔 및 구독
 * - subscribe_for_workflow: action/column_id 필터
 * - inject_and_resume: 상태 미존재, 성공, 실패
 * - notify: 이미 구독 중, 신규 구독
 * - dispose: 구독 해제 + interval 클리어
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { setup_kanban_trigger_watcher } from "@src/services/kanban-trigger-watcher.js";
import type { KanbanEvent } from "@src/services/kanban-store.js";

vi.useFakeTimers();

/** Promise 체인을 여러 tick에 걸쳐 flush (setInterval 진행 없이) */
async function flush(ticks = 4) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

function make_event(overrides: Partial<KanbanEvent["data"]> = {}): KanbanEvent {
  return {
    data: {
      card_id: "card1",
      board_id: "board1",
      action: "move",
      actor: "user",
      detail: { column_id: "col1", to: "col2" },
      created_at: new Date().toISOString(),
      ...overrides,
    },
  } as KanbanEvent;
}

function make_deps() {
  const listeners = new Map<string, Set<(e: KanbanEvent) => void>>();
  const kanban_store = {
    subscribe: vi.fn((board_id: string, listener: (e: KanbanEvent) => void) => {
      if (!listeners.has(board_id)) listeners.set(board_id, new Set());
      listeners.get(board_id)!.add(listener);
    }),
    unsubscribe: vi.fn((board_id: string, listener: (e: KanbanEvent) => void) => {
      listeners.get(board_id)?.delete(listener);
    }),
    emit(board_id: string, event: KanbanEvent) {
      listeners.get(board_id)?.forEach((fn) => fn(event));
    },
  };

  const workflow_store = {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(undefined),
  };

  const resumer = {
    resume: vi.fn().mockResolvedValue({ ok: true }),
  };

  return { kanban_store, workflow_store, resumer };
}

afterEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════
// setup + scan_and_subscribe
// ══════════════════════════════════════════════════════════

describe("KanbanTriggerWatcher — setup 초기 스캔", () => {
  it("waiting 워크플로우 없음 → 구독 없이 초기화", async () => {
    const { kanban_store, workflow_store, resumer } = make_deps();
    workflow_store.list.mockResolvedValue([]);

    const watcher = await setup_kanban_trigger_watcher({ kanban_store, workflow_store, resumer });
    expect(kanban_store.subscribe).not.toHaveBeenCalled();
    watcher.dispose();
  });

  it("__pending_kanban_trigger 없는 waiting → 구독 안 됨", async () => {
    const { kanban_store, workflow_store, resumer } = make_deps();
    workflow_store.list.mockResolvedValue([
      { workflow_id: "wf1", status: "waiting_user_input", memory: {} },
    ]);

    const watcher = await setup_kanban_trigger_watcher({ kanban_store, workflow_store, resumer });
    expect(kanban_store.subscribe).not.toHaveBeenCalled();
    watcher.dispose();
  });

  it("waiting + pending_kanban_trigger + board_id → 구독 등록", async () => {
    const { kanban_store, workflow_store, resumer } = make_deps();
    workflow_store.list.mockResolvedValue([
      {
        workflow_id: "wf1",
        status: "waiting_user_input",
        memory: { __pending_kanban_trigger: { board_id: "board1", node_id: "n1" } },
      },
    ]);

    const watcher = await setup_kanban_trigger_watcher({ kanban_store, workflow_store, resumer });
    expect(kanban_store.subscribe).toHaveBeenCalledWith("board1", expect.any(Function));
    watcher.dispose();
  });

  it("board_id 없는 pending_trigger → 구독 안 됨", async () => {
    const { kanban_store, workflow_store, resumer } = make_deps();
    workflow_store.list.mockResolvedValue([
      {
        workflow_id: "wf1",
        status: "waiting_user_input",
        memory: { __pending_kanban_trigger: { node_id: "n1" } }, // board_id 없음
      },
    ]);

    const watcher = await setup_kanban_trigger_watcher({ kanban_store, workflow_store, resumer });
    expect(kanban_store.subscribe).not.toHaveBeenCalled();
    watcher.dispose();
  });
});

// ══════════════════════════════════════════════════════════
// inject_and_resume — 이벤트 매칭
// ══════════════════════════════════════════════════════════

describe("KanbanTriggerWatcher — inject_and_resume", () => {
  it("이벤트 매칭 → workflow_store.get → upsert → resumer.resume 호출", async () => {
    const { kanban_store, workflow_store, resumer } = make_deps();
    const state = {
      workflow_id: "wf1",
      status: "waiting_user_input",
      memory: { __pending_kanban_trigger: { board_id: "board1", node_id: "n1" } },
    };
    workflow_store.list.mockResolvedValue([state]);
    workflow_store.get.mockResolvedValue(state);

    const watcher = await setup_kanban_trigger_watcher({ kanban_store, workflow_store, resumer });
    kanban_store.emit("board1", make_event());
    await flush();

    expect(resumer.resume).toHaveBeenCalledWith("wf1");
    watcher.dispose();
  });

  it("workflow_store.get → null → resume 미호출", async () => {
    const { kanban_store, workflow_store, resumer } = make_deps();
    const state = {
      workflow_id: "wf1",
      status: "waiting_user_input",
      memory: { __pending_kanban_trigger: { board_id: "board1", node_id: "n1" } },
    };
    workflow_store.list.mockResolvedValue([state]);
    workflow_store.get.mockResolvedValue(null); // 상태 없음

    const watcher = await setup_kanban_trigger_watcher({ kanban_store, workflow_store, resumer });
    kanban_store.emit("board1", make_event());
    await flush();

    expect(resumer.resume).not.toHaveBeenCalled();
    watcher.dispose();
  });

  it("workflow status != waiting_user_input → resume 미호출", async () => {
    const { kanban_store, workflow_store, resumer } = make_deps();
    const state = {
      workflow_id: "wf1",
      status: "waiting_user_input",
      memory: { __pending_kanban_trigger: { board_id: "board1", node_id: "n1" } },
    };
    workflow_store.list.mockResolvedValue([state]);
    workflow_store.get.mockResolvedValue({ ...state, status: "completed" });

    const watcher = await setup_kanban_trigger_watcher({ kanban_store, workflow_store, resumer });
    kanban_store.emit("board1", make_event());
    await flush();

    expect(resumer.resume).not.toHaveBeenCalled();
    watcher.dispose();
  });

  it("resumer.resume 실패 → warn 로그 (에러 없음)", async () => {
    const { kanban_store, workflow_store, resumer } = make_deps();
    const state = {
      workflow_id: "wf1",
      status: "waiting_user_input",
      memory: { __pending_kanban_trigger: { board_id: "board1", node_id: "n1" } },
    };
    workflow_store.list.mockResolvedValue([state]);
    workflow_store.get.mockResolvedValue(state);
    resumer.resume.mockResolvedValue({ ok: false, error: "workflow not found" });

    const watcher = await setup_kanban_trigger_watcher({ kanban_store, workflow_store, resumer });
    kanban_store.emit("board1", make_event());
    await flush();

    expect(resumer.resume).toHaveBeenCalledWith("wf1");
    watcher.dispose();
  });
});

// ══════════════════════════════════════════════════════════
// action / column_id 필터
// ══════════════════════════════════════════════════════════

describe("KanbanTriggerWatcher — 이벤트 필터", () => {
  it("actions 필터: 불일치 → resume 미호출", async () => {
    const { kanban_store, workflow_store, resumer } = make_deps();
    const state = {
      workflow_id: "wf1",
      status: "waiting_user_input",
      memory: {
        __pending_kanban_trigger: { board_id: "board1", node_id: "n1", actions: ["add_card"] },
      },
    };
    workflow_store.list.mockResolvedValue([state]);
    workflow_store.get.mockResolvedValue(state);

    const watcher = await setup_kanban_trigger_watcher({ kanban_store, workflow_store, resumer });
    kanban_store.emit("board1", make_event({ action: "move" })); // "move" ≠ "add_card"
    await flush();

    expect(resumer.resume).not.toHaveBeenCalled();
    watcher.dispose();
  });

  it("actions 필터: 일치 → resume 호출", async () => {
    const { kanban_store, workflow_store, resumer } = make_deps();
    const state = {
      workflow_id: "wf1",
      status: "waiting_user_input",
      memory: {
        __pending_kanban_trigger: { board_id: "board1", node_id: "n1", actions: ["move"] },
      },
    };
    workflow_store.list.mockResolvedValue([state]);
    workflow_store.get.mockResolvedValue(state);

    const watcher = await setup_kanban_trigger_watcher({ kanban_store, workflow_store, resumer });
    kanban_store.emit("board1", make_event({ action: "move" }));
    await flush();

    expect(resumer.resume).toHaveBeenCalledWith("wf1");
    watcher.dispose();
  });

  it("column_id 필터: 불일치 → resume 미호출", async () => {
    const { kanban_store, workflow_store, resumer } = make_deps();
    const state = {
      workflow_id: "wf1",
      status: "waiting_user_input",
      memory: {
        __pending_kanban_trigger: { board_id: "board1", node_id: "n1", column_id: "target_col" },
      },
    };
    workflow_store.list.mockResolvedValue([state]);
    workflow_store.get.mockResolvedValue(state);

    const watcher = await setup_kanban_trigger_watcher({ kanban_store, workflow_store, resumer });
    kanban_store.emit("board1", make_event({ detail: { column_id: "other_col", to: "other_col2" } }));
    await flush();

    expect(resumer.resume).not.toHaveBeenCalled();
    watcher.dispose();
  });

  it("column_id 필터: to 필드 일치 → resume 호출", async () => {
    const { kanban_store, workflow_store, resumer } = make_deps();
    const state = {
      workflow_id: "wf1",
      status: "waiting_user_input",
      memory: {
        __pending_kanban_trigger: { board_id: "board1", node_id: "n1", column_id: "target_col" },
      },
    };
    workflow_store.list.mockResolvedValue([state]);
    workflow_store.get.mockResolvedValue(state);

    const watcher = await setup_kanban_trigger_watcher({ kanban_store, workflow_store, resumer });
    kanban_store.emit("board1", make_event({ detail: { column_id: "from_col", to: "target_col" } }));
    await flush();

    expect(resumer.resume).toHaveBeenCalledWith("wf1");
    watcher.dispose();
  });
});

// ══════════════════════════════════════════════════════════
// notify
// ══════════════════════════════════════════════════════════

describe("KanbanTriggerWatcher — notify", () => {
  it("이미 구독 중인 workflow_id → workflow_store.get 미호출", async () => {
    const { kanban_store, workflow_store, resumer } = make_deps();
    const state = {
      workflow_id: "wf1",
      status: "waiting_user_input",
      memory: { __pending_kanban_trigger: { board_id: "board1", node_id: "n1" } },
    };
    workflow_store.list.mockResolvedValue([state]);

    const watcher = await setup_kanban_trigger_watcher({ kanban_store, workflow_store, resumer });
    workflow_store.get.mockClear();

    watcher.notify("wf1"); // 이미 구독됨
    await flush();

    expect(workflow_store.get).not.toHaveBeenCalled();
    watcher.dispose();
  });

  it("미구독 workflow_id → workflow_store.get → 구독 등록", async () => {
    const { kanban_store, workflow_store, resumer } = make_deps();
    workflow_store.list.mockResolvedValue([]);

    const watcher = await setup_kanban_trigger_watcher({ kanban_store, workflow_store, resumer });

    const state = {
      workflow_id: "wf2",
      status: "waiting_user_input",
      memory: { __pending_kanban_trigger: { board_id: "board2", node_id: "n2" } },
    };
    workflow_store.get.mockResolvedValue(state);

    watcher.notify("wf2");
    await flush();

    expect(kanban_store.subscribe).toHaveBeenCalledWith("board2", expect.any(Function));
    watcher.dispose();
  });

  it("notify → workflow_store.get → null → 구독 안 됨", async () => {
    const { kanban_store, workflow_store, resumer } = make_deps();
    workflow_store.list.mockResolvedValue([]);
    workflow_store.get.mockResolvedValue(null);

    const watcher = await setup_kanban_trigger_watcher({ kanban_store, workflow_store, resumer });
    watcher.notify("wf3");
    await flush();

    expect(kanban_store.subscribe).not.toHaveBeenCalled();
    watcher.dispose();
  });

  it("notify → status != waiting_user_input → 구독 안 됨", async () => {
    const { kanban_store, workflow_store, resumer } = make_deps();
    workflow_store.list.mockResolvedValue([]);
    workflow_store.get.mockResolvedValue({
      workflow_id: "wf4", status: "completed", memory: {},
    });

    const watcher = await setup_kanban_trigger_watcher({ kanban_store, workflow_store, resumer });
    watcher.notify("wf4");
    await flush();

    expect(kanban_store.subscribe).not.toHaveBeenCalled();
    watcher.dispose();
  });

  it("notify → workflow_store.get 에러 → 예외 전파 안 됨", async () => {
    const { kanban_store, workflow_store, resumer } = make_deps();
    workflow_store.list.mockResolvedValue([]);
    workflow_store.get.mockRejectedValue(new Error("db error"));

    const watcher = await setup_kanban_trigger_watcher({ kanban_store, workflow_store, resumer });
    watcher.notify("wf5"); // 에러가 throw되면 안 됨
    await flush(); // warn log만

    expect(kanban_store.subscribe).not.toHaveBeenCalled();
    watcher.dispose();
  });
});

// ══════════════════════════════════════════════════════════
// dispose
// ══════════════════════════════════════════════════════════

describe("KanbanTriggerWatcher — dispose", () => {
  it("dispose → 구독 해제 + interval 정리", async () => {
    const { kanban_store, workflow_store, resumer } = make_deps();
    workflow_store.list.mockResolvedValue([
      {
        workflow_id: "wf1",
        status: "waiting_user_input",
        memory: { __pending_kanban_trigger: { board_id: "board1", node_id: "n1" } },
      },
    ]);

    const watcher = await setup_kanban_trigger_watcher({ kanban_store, workflow_store, resumer });
    expect(kanban_store.subscribe).toHaveBeenCalledTimes(1);

    watcher.dispose();
    expect(kanban_store.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("주기적 스캔 (30초 interval) → 새 waiting 워크플로우 감지", async () => {
    const { kanban_store, workflow_store, resumer } = make_deps();
    workflow_store.list.mockResolvedValue([]); // 처음엔 없음

    const watcher = await setup_kanban_trigger_watcher({ kanban_store, workflow_store, resumer });
    expect(kanban_store.subscribe).not.toHaveBeenCalled();

    // 30초 후 새 waiting 워크플로우 추가
    workflow_store.list.mockResolvedValue([
      {
        workflow_id: "wf_new",
        status: "waiting_user_input",
        memory: { __pending_kanban_trigger: { board_id: "board_new", node_id: "n1" } },
      },
    ]);
    await vi.advanceTimersByTimeAsync(30_001);

    expect(kanban_store.subscribe).toHaveBeenCalledWith("board_new", expect.any(Function));
    watcher.dispose();
  });
});
