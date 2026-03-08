/**
 * WorkflowEventService — append/list/get_task_detail CRUD 테스트.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WorkflowEventService } from "../../src/events/service.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("WorkflowEventService", () => {
  let workspace: string;
  let svc: WorkflowEventService;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "evt-test-"));
    svc = new WorkflowEventService(workspace);
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  });

  it("append: 기본 이벤트 저장 성공", async () => {
    const { deduped, event } = await svc.append({
      phase: "assign",
      summary: "Task started",
      task_id: "t1",
      run_id: "r1",
      chat_id: "c1",
    });
    expect(deduped).toBe(false);
    expect(event.phase).toBe("assign");
    expect(event.summary).toBe("Task started");
    expect(event.event_id).toBeTruthy();
  });

  it("append: 동일 event_id → deduped=true", async () => {
    const event_id = "test-event-123";
    await svc.append({ phase: "progress", summary: "first", event_id });
    const { deduped } = await svc.append({ phase: "done", summary: "second", event_id });
    expect(deduped).toBe(true);
  });

  it("append: source 기본값 → 'system'", async () => {
    const { event } = await svc.append({ phase: "done", summary: "test" });
    expect(event.source).toBe("system");
  });

  it("append: inbound source 지정", async () => {
    const { event } = await svc.append({ phase: "assign", summary: "msg", source: "inbound" });
    expect(event.source).toBe("inbound");
  });

  it("list: 이벤트 목록 조회", async () => {
    await svc.append({ phase: "assign", summary: "e1", task_id: "t1" });
    await svc.append({ phase: "done", summary: "e2", task_id: "t1" });
    const events = await svc.list({ task_id: "t1" });
    expect(events.length).toBe(2);
  });

  it("list: phase 필터", async () => {
    await svc.append({ phase: "assign", summary: "a1", task_id: "t2" });
    await svc.append({ phase: "done", summary: "d1", task_id: "t2" });
    const done_events = await svc.list({ phase: "done", task_id: "t2" });
    expect(done_events.every(e => e.phase === "done")).toBe(true);
  });

  it("list: 빈 상태에서 빈 배열", async () => {
    const events = await svc.list({ task_id: "nonexistent" });
    expect(events).toEqual([]);
  });

  it("append: payload 포함", async () => {
    const { event } = await svc.append({
      phase: "progress",
      summary: "with payload",
      payload: { key: "value", num: 42 },
    });
    expect(event.payload.key).toBe("value");
    expect(event.payload.num).toBe(42);
  });
});
