/**
 * WorkflowEventService — append/list/get_task_detail CRUD 테스트.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkflowEventService } from "../../src/events/service.js";
import type { TaskStoreLike } from "../../src/agent/task-store.js";
import type { TaskState } from "../../src/contracts.js";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { with_sqlite } from "../../src/utils/sqlite-helper.js";

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

describe("WorkflowEventService — list 추가 필터", () => {
  let workspace2: string;
  let svc: WorkflowEventService;

  beforeEach(async () => {
    workspace2 = await mkdtemp(join(tmpdir(), "evt-filter-"));
    svc = new WorkflowEventService(workspace2);
  });

  afterEach(async () => {
    await rm(workspace2, { recursive: true, force: true }).catch(() => {});
  });

  it("run_id 필터", async () => {
    await svc.append({ phase: "assign", summary: "run-x", run_id: "run-x" });
    await svc.append({ phase: "assign", summary: "run-y", run_id: "run-y" });
    const events = await svc.list({ run_id: "run-x" });
    expect(events.length).toBe(1);
    expect(events[0].run_id).toBe("run-x");
  });

  it("agent_id 필터", async () => {
    await svc.append({ phase: "assign", summary: "a", agent_id: "agent-a" });
    await svc.append({ phase: "assign", summary: "b", agent_id: "agent-b" });
    const events = await svc.list({ agent_id: "agent-a" });
    expect(events.every((e) => e.agent_id === "agent-a")).toBe(true);
  });

  it("chat_id 필터", async () => {
    await svc.append({ phase: "assign", summary: "chat1", chat_id: "chat-1" });
    await svc.append({ phase: "assign", summary: "chat2", chat_id: "chat-2" });
    const events = await svc.list({ chat_id: "chat-1" });
    expect(events.every((e) => e.chat_id === "chat-1")).toBe(true);
  });

  it("source 필터 (outbound)", async () => {
    await svc.append({ phase: "assign", summary: "sys", source: "system" });
    await svc.append({ phase: "assign", summary: "out", source: "outbound" });
    const events = await svc.list({ source: "outbound" });
    expect(events.length).toBe(1);
    expect(events[0].source).toBe("outbound");
  });

  it("limit + offset pagination", async () => {
    for (let i = 0; i < 6; i++) {
      await svc.append({ phase: "assign", summary: `event-${i}` });
    }
    const page1 = await svc.list({ limit: 3, offset: 0 });
    const page2 = await svc.list({ limit: 3, offset: 3 });
    expect(page1.length).toBe(3);
    expect(page2.length).toBe(3);
  });
});

describe("WorkflowEventService — read_task_detail", () => {
  let workspace3: string;
  let svc: WorkflowEventService;

  beforeEach(async () => {
    workspace3 = await mkdtemp(join(tmpdir(), "evt-detail-"));
    svc = new WorkflowEventService(workspace3);
  });

  afterEach(async () => {
    await rm(workspace3, { recursive: true, force: true }).catch(() => {});
  });

  it("detail 있으면 read_task_detail로 읽기", async () => {
    await svc.append({ phase: "progress", summary: "진행", task_id: "t-det", detail: "step 1\nstep 2" });
    const text = await svc.read_task_detail("t-det");
    expect(text).toContain("step 1");
    expect(text).toContain("step 2");
  });

  it("여러 번 detail append → 누적됨", async () => {
    await svc.append({ phase: "progress", summary: "1단계", task_id: "t-acc", detail: "first" });
    await svc.append({ phase: "progress", summary: "2단계", task_id: "t-acc", detail: "second" });
    const text = await svc.read_task_detail("t-acc");
    expect(text).toContain("first");
    expect(text).toContain("second");
  });

  it("존재하지 않는 task_id → 빈 문자열", async () => {
    expect(await svc.read_task_detail("no-such-task")).toBe("");
  });

  it("task_id 빈 문자열 → 빈 문자열", async () => {
    expect(await svc.read_task_detail("")).toBe("");
  });
});

describe("WorkflowEventService — bind_task_store (sync_task_state)", () => {
  let workspace4: string;
  let svc: WorkflowEventService;

  function make_task_store() {
    const store = new Map<string, TaskState>();
    const ts: TaskStoreLike = {
      get: async (id: string) => store.get(id) ?? null,
      upsert: async (task: TaskState) => {
        const key = (task as any).taskId || (task as any).task_id || "unknown";
        store.set(key, task);
      },
      list: async () => [...store.values()],
      delete: async (id: string) => { store.delete(id); },
    } as unknown as TaskStoreLike;
    return { store, ts };
  }

  beforeEach(async () => {
    workspace4 = await mkdtemp(join(tmpdir(), "evt-sync-"));
    svc = new WorkflowEventService(workspace4);
  });

  afterEach(async () => {
    await rm(workspace4, { recursive: true, force: true }).catch(() => {});
  });

  it("done 이벤트 → task status=completed", async () => {
    const { store, ts } = make_task_store();
    svc.bind_task_store(ts);
    await svc.append({ phase: "done", summary: "완료", task_id: "t-sync", run_id: "r1", agent_id: "a1", chat_id: "c1" });
    const task = store.get("t-sync");
    expect(task?.status).toBe("completed");
  });

  it("approval 이벤트 → task status=waiting_approval", async () => {
    const { store, ts } = make_task_store();
    svc.bind_task_store(ts);
    await svc.append({ phase: "approval", summary: "승인 필요", task_id: "t-appr", run_id: "r1", agent_id: "a1", chat_id: "c1" });
    const task = store.get("t-appr");
    expect(task?.status).toBe("waiting_approval");
  });

  it("blocked + '승인' 포함 summary → waiting_approval", async () => {
    const { store, ts } = make_task_store();
    svc.bind_task_store(ts);
    await svc.append({ phase: "blocked", summary: "대기 중 - 승인 필요", task_id: "t-blk1", run_id: "r1", agent_id: "a1", chat_id: "c1" });
    const task = store.get("t-blk1");
    expect(task?.status).toBe("waiting_approval");
    expect(task?.exitReason).toBe("approval_wait_event");
  });

  it("blocked + 일반 summary → failed", async () => {
    const { store, ts } = make_task_store();
    svc.bind_task_store(ts);
    await svc.append({ phase: "blocked", summary: "예외 발생으로 실패", task_id: "t-blk2", run_id: "r1", agent_id: "a1", chat_id: "c1" });
    const task = store.get("t-blk2");
    expect(task?.status).toBe("failed");
    expect(task?.exitReason).toBe("workflow_blocked_event");
  });

  it("assign 이벤트 → task status=running, exitReason undefined", async () => {
    const { store, ts } = make_task_store();
    svc.bind_task_store(ts);
    await svc.append({ phase: "assign", summary: "시작", task_id: "t-run", run_id: "r1", agent_id: "a1", chat_id: "c1" });
    const task = store.get("t-run");
    expect(task?.status).toBe("running");
    expect(task?.exitReason).toBeUndefined();
  });

  it("기존 task 있으면 currentTurn 증가 + memory 보존", async () => {
    const { store, ts } = make_task_store();
    store.set("t-upd", {
      taskId: "t-upd",
      task_id: "t-upd",
      title: "기존 타이틀",
      currentTurn: 5,
      status: "running",
      memory: { custom: "value" },
    } as unknown as TaskState);
    svc.bind_task_store(ts);
    await svc.append({ phase: "done", summary: "완료", task_id: "t-upd", run_id: "r1", agent_id: "a1", chat_id: "c1" });
    const task = store.get("t-upd");
    expect(task?.currentTurn).toBe(6);
    expect((task?.memory as any)?.custom).toBe("value");
  });

  it("null task_store bind 후 append → 에러 없음", async () => {
    svc.bind_task_store(null);
    await expect(svc.append({ phase: "done", summary: "완료" })).resolves.toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════
// L206: row_to_event catch — 잘못된 payload_json → null 필터됨
// ══════════════════════════════════════════════════════════════

describe("WorkflowEventService — row_to_event catch (L206)", () => {
  let workspace5: string;
  let svc: WorkflowEventService;

  beforeEach(async () => {
    workspace5 = await mkdtemp(join(tmpdir(), "evt-rte-"));
    svc = new WorkflowEventService(workspace5);
  });

  afterEach(async () => {
    await rm(workspace5, { recursive: true, force: true }).catch(() => {});
  });

  it("잘못된 payload_json → row_to_event catch → null → list에서 제외 (L206)", async () => {
    // 이벤트 정상 저장
    await svc.append({ phase: "done", summary: "정상 이벤트", task_id: "t-rte" });

    // DB에서 직접 payload_json을 잘못된 JSON으로 교체
    const sqlite_path = join(workspace5, "runtime", "events", "events.db");
    with_sqlite(sqlite_path, (db) => {
      db.prepare("UPDATE workflow_events SET payload_json = ? WHERE task_id = ?")
        .run("{{{invalid json", "t-rte");
    });

    // list() → row_to_event catch → null → filter → 빈 배열
    const events = await svc.list({ task_id: "t-rte" });
    // payload_json 파싱 실패 → row_to_event catch (L206) → null → filtered out
    expect(events.length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════
// L182: schema initialization failed — logger.error 호출
// ══════════════════════════════════════════════════════════════

describe("WorkflowEventService — schema init failed → append rejects", () => {
  it("DB 경로가 디렉토리 → with_sqlite_strict throw → initialized reject → append reject", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "evt-init-fail-"));
    try {
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
      const events_dir = join(tmp, "events");
      await mkdir(events_dir, { recursive: true });
      await mkdir(join(events_dir, "events.db"), { recursive: true });
      const svc2 = new WorkflowEventService(tmp, events_dir, logger);
      await expect(
        svc2.append({ phase: "assign", summary: "test" }),
      ).rejects.toThrow();
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  });
});

// ══════════════════════════════════════════════════════════════
// cov2: enqueue_write rejection, sync_task_state empty task_id
// ══════════════════════════════════════════════════════════════

describe("WorkflowEventService — enqueue_write rejection handler", () => {
  it("job throw → rejection handler 실행 → write_queue 갱신됨", async () => {
    const svc2 = new WorkflowEventService("/tmp/test-evt-cov2-" + Date.now());
    let rejection_count = 0;
    await (svc2 as any).enqueue_write(async () => {
      throw new Error("forced job failure");
    }).catch(() => { rejection_count++; });
    expect(rejection_count).toBe(1);
    await expect((svc2 as any).write_queue).resolves.toBeUndefined();
  });
});

describe("WorkflowEventService — sync_task_state_from_event 빈 task_id", () => {
  it("task_id='' → early return, task_store.get 미호출", async () => {
    const svc2 = new WorkflowEventService("/tmp/test-evt-cov2-sync-" + Date.now());
    const task_store_mock = { get: vi.fn(), set: vi.fn() };
    svc2.bind_task_store(task_store_mock as any);
    await (svc2 as any).sync_task_state_from_event({
      event_id: "e1", run_id: "r1", task_id: "", agent_id: "a1",
      phase: "assign", summary: "s", payload: {}, chat_id: "c",
      source: "system", at: new Date().toISOString(),
    });
    expect(task_store_mock.get).not.toHaveBeenCalled();
  });

  it("task_id 공백만 → early return", async () => {
    const svc2 = new WorkflowEventService("/tmp/test-evt-cov2-sync2-" + Date.now());
    const task_store_mock = { get: vi.fn(), set: vi.fn() };
    svc2.bind_task_store(task_store_mock as any);
    await (svc2 as any).sync_task_state_from_event({
      event_id: "e2", run_id: "r1", task_id: "   ", agent_id: "a1",
      phase: "assign", summary: "s", payload: {}, chat_id: "c",
      source: "system", at: new Date().toISOString(),
    });
    expect(task_store_mock.get).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════
// team_id 저장·필터 — 멀티테넌트 데이터 격리 검증
// ══════════════════════════════════════════════════════════════

describe("WorkflowEventService — team_id 저장·필터", () => {
  let workspace_tid: string;
  let svc: WorkflowEventService;

  beforeEach(async () => {
    workspace_tid = await mkdtemp(join(tmpdir(), "evt-tid-"));
    svc = new WorkflowEventService(workspace_tid);
  });

  afterEach(async () => {
    await rm(workspace_tid, { recursive: true, force: true }).catch(() => {});
  });

  it("append: team_id 저장 + 반환", async () => {
    const { event } = await svc.append({ phase: "assign", summary: "팀 이벤트", team_id: "team_a" });
    expect(event.team_id).toBe("team_a");
  });

  it("append: team_id 미지정 → 빈 문자열", async () => {
    const { event } = await svc.append({ phase: "assign", summary: "무팀 이벤트" });
    expect(event.team_id).toBe("");
  });

  it("list: team_id 필터로 해당 팀만 조회", async () => {
    await svc.append({ phase: "assign", summary: "a1", team_id: "team_a" });
    await svc.append({ phase: "assign", summary: "b1", team_id: "team_b" });
    await svc.append({ phase: "assign", summary: "a2", team_id: "team_a" });
    const events = await svc.list({ team_id: "team_a" });
    expect(events.length).toBe(2);
    expect(events.every((e) => e.team_id === "team_a")).toBe(true);
  });

  it("list: team_id 미지정 → 전체 반환", async () => {
    await svc.append({ phase: "assign", summary: "a1", team_id: "team_a" });
    await svc.append({ phase: "assign", summary: "b1", team_id: "team_b" });
    const events = await svc.list({});
    expect(events.length).toBe(2);
  });

  it("list: team_id='' → 빈 team_id 이벤트만 반환", async () => {
    await svc.append({ phase: "assign", summary: "no-team" });
    await svc.append({ phase: "assign", summary: "has-team", team_id: "team_a" });
    const events = await svc.list({ team_id: "" });
    expect(events.length).toBe(1);
    expect(events[0].summary).toBe("no-team");
  });

  it("dedup: 동일 event_id → team_id 보존", async () => {
    const eid = "dedup-tid-test";
    await svc.append({ phase: "assign", summary: "first", event_id: eid, team_id: "team_x" });
    const { deduped, event } = await svc.append({ phase: "done", summary: "second", event_id: eid, team_id: "team_y" });
    expect(deduped).toBe(true);
    expect(event.team_id).toBe("team_x");
  });

  it("team_id DB 컬럼에 저장됨 (직접 조회)", async () => {
    await svc.append({ phase: "assign", summary: "db-check", event_id: "db-tid", team_id: "team_db" });
    const sqlite_path = join(workspace_tid, "runtime", "events", "events.db");
    const row = with_sqlite(sqlite_path, (db) =>
      db.prepare("SELECT team_id FROM workflow_events WHERE event_id = ?").get("db-tid") as { team_id: string } | undefined,
    );
    expect(row?.team_id).toBe("team_db");
  });
});

// ══════════════════════════════════════════════════════════════
// FE-6: user_id 저장·필터 — 사용자별 이벤트 격리 검증
// ══════════════════════════════════════════════════════════════

describe("WorkflowEventService — user_id 저장·필터 (FE-6)", () => {
  let workspace_uid: string;
  let svc: WorkflowEventService;

  beforeEach(async () => {
    workspace_uid = await mkdtemp(join(tmpdir(), "evt-uid-"));
    svc = new WorkflowEventService(workspace_uid);
  });

  afterEach(async () => {
    await rm(workspace_uid, { recursive: true, force: true }).catch(() => {});
  });

  it("append: user_id 저장 + 반환", async () => {
    const { event } = await svc.append({ phase: "assign", summary: "유저 이벤트", user_id: "user-A" });
    expect(event.user_id).toBe("user-A");
  });

  it("append: user_id 미지정 → 빈 문자열", async () => {
    const { event } = await svc.append({ phase: "assign", summary: "무유저 이벤트" });
    expect(event.user_id).toBe("");
  });

  it("list: user_id 필터로 해당 사용자만 조회", async () => {
    await svc.append({ phase: "assign", summary: "a-event", user_id: "user-A" });
    await svc.append({ phase: "assign", summary: "b-event", user_id: "user-B" });
    await svc.append({ phase: "assign", summary: "a-event2", user_id: "user-A" });
    const events = await svc.list({ user_id: "user-A" });
    expect(events.length).toBe(2);
    expect(events.every((e) => e.user_id === "user-A")).toBe(true);
  });

  it("list: user_id 미지정 → 전체 반환", async () => {
    await svc.append({ phase: "assign", summary: "a", user_id: "user-A" });
    await svc.append({ phase: "assign", summary: "b", user_id: "user-B" });
    const events = await svc.list({});
    expect(events.length).toBe(2);
  });

  it("user_id DB 컬럼에 저장됨 (직접 조회)", async () => {
    await svc.append({ phase: "assign", summary: "db-check", event_id: "db-uid", user_id: "user-db" });
    const sqlite_path = join(workspace_uid, "runtime", "events", "events.db");
    const row = with_sqlite(sqlite_path, (db) =>
      db.prepare("SELECT user_id FROM workflow_events WHERE event_id = ?").get("db-uid") as { user_id: string } | undefined,
    );
    expect(row?.user_id).toBe("user-db");
  });

  it("team_id + user_id 조합 필터", async () => {
    await svc.append({ phase: "assign", summary: "t1-u1", team_id: "t1", user_id: "u1" });
    await svc.append({ phase: "assign", summary: "t1-u2", team_id: "t1", user_id: "u2" });
    await svc.append({ phase: "assign", summary: "t2-u1", team_id: "t2", user_id: "u1" });
    const events = await svc.list({ team_id: "t1", user_id: "u1" });
    expect(events.length).toBe(1);
    expect(events[0].summary).toBe("t1-u1");
  });
});
