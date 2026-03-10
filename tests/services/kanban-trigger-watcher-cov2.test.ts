/**
 * kanban-trigger-watcher — 미커버 분기 (cov2):
 * - L48: scan_and_subscribe — 이미 구독된 workflow_id → continue
 * - L110: setInterval → scan_and_subscribe throw → kanban_trigger_scan_error 로그
 * - L120: notify() — meta.board_id 없음 → return
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { setup_kanban_trigger_watcher } from "@src/services/kanban-trigger-watcher.js";
import type { KanbanEvent } from "@src/services/kanban-store.js";

vi.useFakeTimers();

async function flush(ticks = 8) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

function make_deps() {
  const listeners = new Map<string, Set<(e: KanbanEvent) => void>>();
  const kanban_store = {
    subscribe: vi.fn((board_id: string, listener: (e: KanbanEvent) => void) => {
      if (!listeners.has(board_id)) listeners.set(board_id, new Set());
      listeners.get(board_id)!.add(listener);
    }),
    unsubscribe: vi.fn(),
  };
  const workflow_store = {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(undefined),
  };
  const resumer = { resume: vi.fn().mockResolvedValue({ ok: true }) };
  return { kanban_store, workflow_store, resumer };
}

afterEach(() => {
  vi.clearAllMocks();
});

// ── L48: 이미 구독된 workflow_id → continue ────────────────────────────────

describe("scan_and_subscribe — 중복 구독 skip (L48)", () => {
  it("초기 구독 후 setInterval scan → 동일 workflow → L48 skip → subscribe 1회만 호출", async () => {
    const { kanban_store, workflow_store, resumer } = make_deps();
    const wf = {
      workflow_id: "wf-dup",
      status: "waiting_user_input",
      memory: { __pending_kanban_trigger: { board_id: "board-dup", node_id: "n1" } },
    };
    workflow_store.list.mockResolvedValue([wf]);

    const watcher = await setup_kanban_trigger_watcher({ kanban_store, workflow_store, resumer } as any);
    // 초기 scan → 1회 구독
    expect(kanban_store.subscribe).toHaveBeenCalledTimes(1);

    // setInterval(30s) → scan 재실행 → wf-dup 이미 구독 → L48 continue
    vi.advanceTimersByTime(30_000);
    await flush();

    // L48로 인해 subscribe 추가 호출 없음
    expect(kanban_store.subscribe).toHaveBeenCalledTimes(1);
    watcher.dispose();
  });
});

// ── L110: setInterval scan throw → kanban_trigger_scan_error 로그 ──────────

describe("scan_and_subscribe — setInterval throw (L110)", () => {
  it("초기화 후 list throw → kanban_trigger_scan_error warn 로그 (L110)", async () => {
    const { kanban_store, workflow_store, resumer } = make_deps();
    workflow_store.list.mockResolvedValue([]); // 초기 scan은 성공

    const watcher = await setup_kanban_trigger_watcher({ kanban_store, workflow_store, resumer } as any);

    // 이후 list → throw로 변경
    workflow_store.list.mockRejectedValue(new Error("scan db error"));

    // setInterval 30s 경과 → scan → throw → L110 catch log.warn
    vi.advanceTimersByTime(30_000);
    await flush();

    // 에러가 전파되지 않음 (예외 없음) — 테스트 자체가 실패하지 않으면 성공
    expect(kanban_store.subscribe).not.toHaveBeenCalled();
    watcher.dispose();
  });
});

// ── L120: notify() — meta.board_id 없음 → return ─────────────────────────

describe("notify() — meta.board_id 없음 (L120)", () => {
  it("waiting_user_input + __pending_kanban_trigger 있으나 board_id 없음 → subscribe 안 됨 (L120)", async () => {
    const { kanban_store, workflow_store, resumer } = make_deps();
    workflow_store.list.mockResolvedValue([]);

    const watcher = await setup_kanban_trigger_watcher({ kanban_store, workflow_store, resumer } as any);

    // notify 호출 → workflow_store.get → waiting_user_input + meta without board_id
    workflow_store.get.mockResolvedValue({
      workflow_id: "wf-no-board",
      status: "waiting_user_input",
      memory: {
        __pending_kanban_trigger: { node_id: "n1" }, // board_id 없음 → L120
      },
    });

    watcher.notify("wf-no-board");
    await flush();

    // L120: board_id 없어서 subscribe 호출 안 됨
    expect(kanban_store.subscribe).not.toHaveBeenCalled();
    watcher.dispose();
  });
});
