/**
 * WorkflowEventService — 미커버 분기 (cov2):
 * - L68: enqueue_write — job 실패 시 write_queue rejection handler (() => undefined)
 * - L246: append_task_detail → with_sqlite=null → if(!ok) return null
 * - L400: sync_task_state_from_event → normalize_text(task_id)="" → if(!task_id) return
 */
import { describe, it, expect, vi } from "vitest";
import { WorkflowEventService } from "@src/events/service.js";
import type { WorkflowEvent } from "@src/events/types.js";

function make_event(overrides: Partial<WorkflowEvent> = {}): WorkflowEvent {
  return {
    event_id: "evt-1",
    run_id: "run-1",
    task_id: "task-1",
    agent_id: "agent-1",
    phase: "assign",
    summary: "test summary",
    payload: {},
    chat_id: "ch-1",
    source: "system",
    at: new Date().toISOString(),
    ...overrides,
  };
}

// ── L68: enqueue_write rejection handler ─────────────────────────────────────

describe("WorkflowEventService — L68: enqueue_write rejection handler", () => {
  it("job가 throw → run.then(,() => undefined) rejection handler 실행 → write_queue 갱신됨", async () => {
    const svc = new WorkflowEventService("/tmp/test-evt-cov2-" + Date.now());

    // enqueue_write를 직접 호출하여 job이 throw → L68 rejection handler 커버
    let rejection_count = 0;
    await (svc as any).enqueue_write(async () => {
      throw new Error("forced job failure");
    }).catch(() => { rejection_count++; });

    expect(rejection_count).toBe(1); // 에러가 위로 전파됨
    // write_queue는 여전히 유효한 Promise여야 함 (rejection handler가 undefined 반환)
    await expect((svc as any).write_queue).resolves.toBeUndefined();
  });
});

// ── L246: append_task_detail → DB 없음 → null 반환 ───────────────────────────

describe("WorkflowEventService — L246: append_task_detail DB 미초기화 → null", () => {
  it("DB 파일 미존재 상태에서 append_task_detail 직접 호출 → with_sqlite=null → L246 null 반환", async () => {
    // 존재하지 않는 경로 → DB 파일 없음 → with_sqlite returns null
    const svc = new WorkflowEventService("/tmp/nonexistent-db-cov2-" + Date.now());

    const event = make_event({ task_id: "t-detail-test" });
    const result = await (svc as any).append_task_detail(event, "some detail content");

    // DB가 초기화되지 않아 with_sqlite가 null 반환 → L246 null 반환
    expect(result).toBeNull();
  });
});

// ── L400: sync_task_state_from_event → empty task_id → early return ───────────

describe("WorkflowEventService — L400: sync_task_state_from_event 빈 task_id", () => {
  it("task_id 공백/빈 문자열 → normalize_text='' → L400 early return", async () => {
    const svc = new WorkflowEventService("/tmp/test-evt-cov2-sync-" + Date.now());
    const task_store_mock = { get: vi.fn(), set: vi.fn() };
    svc.bind_task_store(task_store_mock as any);

    // task_id가 빈 문자열 → normalize_text("") = "" → L400: if(!task_id) return
    const event = make_event({ task_id: "" });
    await (svc as any).sync_task_state_from_event(event);

    // task_store.get이 호출되지 않아야 함 (early return at L400)
    expect(task_store_mock.get).not.toHaveBeenCalled();
  });

  it("task_id=null-like (공백만) → L400 early return", async () => {
    const svc = new WorkflowEventService("/tmp/test-evt-cov2-sync2-" + Date.now());
    const task_store_mock = { get: vi.fn(), set: vi.fn() };
    svc.bind_task_store(task_store_mock as any);

    const event = make_event({ task_id: "   " }); // 공백만 → normalize_text trims → ""
    await (svc as any).sync_task_state_from_event(event);

    expect(task_store_mock.get).not.toHaveBeenCalled();
  });
});
