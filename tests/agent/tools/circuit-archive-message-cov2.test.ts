/**
 * CircuitBreakerTool / ArchiveTool / MessageTool / TaskStore — 미커버 분기 보충.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { with_sqlite } from "@src/utils/sqlite-helper.js";

// ══════════════════════════════════════════
// CircuitBreakerTool
// ══════════════════════════════════════════

import { CircuitBreakerTool } from "@src/agent/tools/circuit-breaker.js";

// 각 describe 블록은 독립된 breaker name을 사용 (모듈 레벨 Map 공유 방지)
const uid = () => `cb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

describe("CircuitBreakerTool — create / get_state / reset", () => {
  let tool: CircuitBreakerTool;
  beforeEach(() => { tool = new CircuitBreakerTool(); });

  it("create → closed 상태로 생성됨", async () => {
    const name = uid();
    const r = JSON.parse(await tool.execute({ action: "create", name, threshold: 3, reset_timeout_ms: 1000, half_open_max: 2 }));
    expect(r.created).toBe(true);
    expect(r.state).toBe("closed");
    expect(r.threshold).toBe(3);
  });

  it("get_state 없는 name → not_found", async () => {
    const r = JSON.parse(await tool.execute({ action: "get_state", name: `nonexistent-${uid()}` }));
    expect(r.state).toBe("not_found");
  });

  it("reset 없는 name → error: not found", async () => {
    const r = JSON.parse(await tool.execute({ action: "reset", name: `nonexistent-${uid()}` }));
    expect(r.error).toBe("not found");
  });

  it("reset 후 카운트 초기화 + closed", async () => {
    const name = uid();
    await tool.execute({ action: "create", name, threshold: 3 });
    await tool.execute({ action: "record_failure", name });
    await tool.execute({ action: "record_failure", name });
    const r = JSON.parse(await tool.execute({ action: "reset", name }));
    expect(r.state).toBe("closed");
    expect(r.reset).toBe(true);
    const state = JSON.parse(await tool.execute({ action: "get_state", name }));
    expect(state.failure_count).toBe(0);
  });
});

describe("CircuitBreakerTool — record_failure half_open 전이", () => {
  let tool: CircuitBreakerTool;
  beforeEach(() => { tool = new CircuitBreakerTool(); });

  it("closed → 실패 누적 → open 전이", async () => {
    const name = uid();
    await tool.execute({ action: "create", name, threshold: 2 });
    await tool.execute({ action: "record_failure", name });
    const r = JSON.parse(await tool.execute({ action: "record_failure", name }));
    expect(r.state).toBe("open");
    expect(r.tripped).toBe(true);
  });

  it("open 상태에서 record_failure → 여전히 open", async () => {
    const name = uid();
    await tool.execute({ action: "create", name, threshold: 1 });
    await tool.execute({ action: "record_failure", name }); // trips open
    const r = JSON.parse(await tool.execute({ action: "record_failure", name }));
    expect(r.state).toBe("open");
  });
});

describe("CircuitBreakerTool — half_open 전이 (get_state timeout)", () => {
  let tool: CircuitBreakerTool;
  beforeEach(() => { tool = new CircuitBreakerTool(); });

  it("open + elapsed > reset_timeout → get_state returns half_open", async () => {
    const name = uid();
    await tool.execute({ action: "create", name, threshold: 1, reset_timeout_ms: 1 }); // 1ms timeout
    await tool.execute({ action: "record_failure", name }); // trips to open
    await new Promise((r) => setTimeout(r, 10)); // 10ms > 1ms
    const state = JSON.parse(await tool.execute({ action: "get_state", name }));
    expect(state.state).toBe("half_open");
    expect(state.can_request).toBe(true);
  });

  it("half_open + record_success → closed 전이", async () => {
    const name = uid();
    await tool.execute({ action: "create", name, threshold: 1, reset_timeout_ms: 1 });
    await tool.execute({ action: "record_failure", name });
    await new Promise((r) => setTimeout(r, 10));
    await tool.execute({ action: "get_state", name }); // triggers half_open
    const r = JSON.parse(await tool.execute({ action: "record_success", name }));
    expect(r.state).toBe("closed");
  });

  it("half_open + record_failure → open 전이", async () => {
    const name = uid();
    await tool.execute({ action: "create", name, threshold: 1, reset_timeout_ms: 1 });
    await tool.execute({ action: "record_failure", name });
    await new Promise((r) => setTimeout(r, 10));
    await tool.execute({ action: "get_state", name }); // triggers half_open
    // 직접 상태를 half_open으로 설정 (get_state가 전이했음)
    const r = JSON.parse(await tool.execute({ action: "record_failure", name }));
    expect(r.state).toBe("open");
  });
});

describe("CircuitBreakerTool — stats / config", () => {
  let tool: CircuitBreakerTool;
  beforeEach(() => { tool = new CircuitBreakerTool(); });

  it("stats all → 모든 breaker 목록", async () => {
    const n1 = uid(); const n2 = uid();
    await tool.execute({ action: "create", name: n1 });
    await tool.execute({ action: "create", name: n2 });
    const r = JSON.parse(await tool.execute({ action: "stats", name: "all" }));
    expect(r.count).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(r.breakers)).toBe(true);
  });

  it("stats specific name → uptime_percent 포함", async () => {
    const name = uid();
    await tool.execute({ action: "create", name });
    await tool.execute({ action: "record_success", name });
    await tool.execute({ action: "record_success", name });
    await tool.execute({ action: "record_failure", name });
    const r = JSON.parse(await tool.execute({ action: "stats", name }));
    expect(r.uptime_percent).toBe(66.67);
  });

  it("stats specific name 없음 → error: not found", async () => {
    const r = JSON.parse(await tool.execute({ action: "stats", name: `nf-${uid()}` }));
    expect(r.error).toBe("not found");
  });

  it("config → threshold/reset_timeout_ms 업데이트", async () => {
    const name = uid();
    await tool.execute({ action: "create", name });
    const r = JSON.parse(await tool.execute({ action: "config", name, threshold: 10, reset_timeout_ms: 5000, half_open_max: 3 }));
    expect(r.threshold).toBe(10);
    expect(r.reset_timeout_ms).toBe(5000);
    expect(r.half_open_max).toBe(3);
  });

  it("record_success 기본 상태 (closed) → can_request=true", async () => {
    const name = uid();
    await tool.execute({ action: "create", name });
    await tool.execute({ action: "record_success", name });
    const state = JSON.parse(await tool.execute({ action: "get_state", name }));
    expect(state.can_request).toBe(true);
    expect(state.success_count).toBe(1);
  });

  it("unknown action → error", async () => {
    const r = JSON.parse(await tool.execute({ action: "fly" }));
    expect(r.error).toContain("unknown action");
  });
});

// ══════════════════════════════════════════
// ArchiveTool — shell_runtime 모킹
// ══════════════════════════════════════════

const { mock_run_shell } = vi.hoisted(() => ({ mock_run_shell: vi.fn() }));

vi.mock("@src/agent/tools/shell-runtime.js", () => ({
  run_shell_command: mock_run_shell,
}));

import { ArchiveTool } from "@src/agent/tools/archive.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "archive-cov2-"));
  mock_run_shell.mockResolvedValue({ stdout: "file1.txt\nfile2.txt", stderr: "" });
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  vi.clearAllMocks();
});

function make_archive(ws = workspace) {
  return new ArchiveTool({ workspace: ws });
}

describe("ArchiveTool — archive_path 필수", () => {
  it("archive_path 없음 → Error", async () => {
    const r = await make_archive().execute({ operation: "list", archive_path: "" });
    expect(r).toContain("Error");
  });
});

describe("ArchiveTool — cancelled signal", () => {
  it("AbortSignal aborted → Error: cancelled", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await (make_archive() as any).run(
      { operation: "list", archive_path: "a.tar.gz" },
      { signal: ctrl.signal },
    );
    expect(r).toContain("cancelled");
  });
});

describe("ArchiveTool — tar.gz 명령 분기", () => {
  it("list tar.gz → tar tzf 호출", async () => {
    const r = await make_archive().execute({ operation: "list", archive_path: "/tmp/test.tar.gz" });
    expect(mock_run_shell).toHaveBeenCalled();
    const cmd = mock_run_shell.mock.calls[0][0] as string;
    expect(cmd).toContain("tar tzf");
    expect(r).toContain("file1.txt");
  });

  it("extract tar.gz → tar xzf 호출", async () => {
    await make_archive().execute({ operation: "extract", archive_path: "/tmp/test.tar.gz", output_dir: "/tmp/out" });
    const cmd = mock_run_shell.mock.calls[0][0] as string;
    expect(cmd).toContain("tar xzf");
    expect(cmd).toContain("-C");
  });

  it("create tar.gz with files → tar czf 호출", async () => {
    await make_archive().execute({ operation: "create", archive_path: "/tmp/out.tar.gz", files: "a.txt b.txt" });
    const cmd = mock_run_shell.mock.calls[0][0] as string;
    expect(cmd).toContain("tar czf");
    expect(cmd).toContain("a.txt b.txt");
  });

  it("create tar.gz without files → Error: unsupported", async () => {
    const r = await make_archive().execute({ operation: "create", archive_path: "/tmp/out.tar.gz" });
    expect(r).toContain("Error");
  });
});

describe("ArchiveTool — zip 명령 분기", () => {
  it("list zip → unzip -l 호출", async () => {
    await make_archive().execute({ operation: "list", archive_path: "/tmp/test.zip", format: "zip" });
    const cmd = mock_run_shell.mock.calls[0][0] as string;
    expect(cmd).toContain("unzip -l");
  });

  it("extract zip → unzip -o 호출", async () => {
    await make_archive().execute({ operation: "extract", archive_path: "/tmp/test.zip", format: "zip", output_dir: "/tmp/out" });
    const cmd = mock_run_shell.mock.calls[0][0] as string;
    expect(cmd).toContain("unzip -o");
  });

  it("create zip with files → zip -r 호출", async () => {
    await make_archive().execute({ operation: "create", archive_path: "/tmp/out.zip", format: "zip", files: "src/" });
    const cmd = mock_run_shell.mock.calls[0][0] as string;
    expect(cmd).toContain("zip -r");
  });

  it("create zip without files → Error: unsupported", async () => {
    const r = await make_archive().execute({ operation: "create", archive_path: "/tmp/out.zip", format: "zip" });
    expect(r).toContain("Error");
  });
});

describe("ArchiveTool — 지원하지 않는 format", () => {
  it("format=rar → Error: unsupported", async () => {
    const r = await make_archive().execute({ operation: "list", archive_path: "/tmp/test.rar", format: "rar" });
    expect(r).toContain("Error");
    expect(r).toContain("unsupported");
  });
});

describe("ArchiveTool — stdout 없는 경우 완료 메시지 반환", () => {
  it("stdout 빈 경우 → 'completed' 메시지", async () => {
    mock_run_shell.mockResolvedValueOnce({ stdout: "", stderr: "" });
    const r = await make_archive().execute({ operation: "list", archive_path: "/tmp/test.tar.gz" });
    expect(r).toContain("completed");
  });

  it("stderr만 있는 경우 → STDERR 포함", async () => {
    mock_run_shell.mockResolvedValueOnce({ stdout: "", stderr: "some warning" });
    const r = await make_archive().execute({ operation: "list", archive_path: "/tmp/test.tar.gz" });
    expect(r).toContain("STDERR");
    expect(r).toContain("some warning");
  });

  it("shell_command throw → Error 반환", async () => {
    mock_run_shell.mockRejectedValueOnce(new Error("command not found"));
    const r = await make_archive().execute({ operation: "list", archive_path: "/tmp/test.tar.gz" });
    expect(r).toContain("Error");
    expect(r).toContain("command not found");
  });
});

// ══════════════════════════════════════════
// MessageTool — 미커버 분기 보충
// ══════════════════════════════════════════

import { MessageTool } from "@src/agent/tools/message.js";

describe("MessageTool — 미커버 분기", () => {
  const WS = workspace || "/tmp/ws";

  it("content 없고 detail만 있음 → detail 첫 줄을 content로 사용", async () => {
    const send_cb = vi.fn().mockResolvedValue(undefined);
    const tool = new MessageTool({ workspace: WS, send_callback: send_cb });
    const r = await tool.execute(
      { content: "", detail: "First line of detail\nSecond line" },
      { channel: "slack", chat_id: "C1" } as any,
    );
    expect(r).not.toContain("Error");
    expect(send_cb).toHaveBeenCalled();
    const msg = send_cb.mock.calls[0][0];
    expect(msg.content).toBe("First line of detail");
  });

  it("content도 없고 detail도 없음 → Error: content or detail", async () => {
    const send_cb = vi.fn().mockResolvedValue(undefined);
    const tool = new MessageTool({ workspace: WS, send_callback: send_cb });
    const r = await tool.execute(
      { content: "" },
      { channel: "slack", chat_id: "C1" } as any,
    );
    expect(r).toContain("Error");
    expect(r).toContain("content");
  });

  it("channel/chat_id 없음 → Error: channel and chat_id", async () => {
    const send_cb = vi.fn().mockResolvedValue(undefined);
    const tool = new MessageTool({ workspace: WS, send_callback: send_cb });
    const r = await tool.execute({ content: "hello" }); // context 없음
    expect(r).toContain("Error");
    expect(r).toContain("channel");
  });

  it("event_recorder 예외 → Error: event_record_failed", async () => {
    const send_cb = vi.fn().mockResolvedValue(undefined);
    const event_cb = vi.fn().mockRejectedValue(new Error("db error"));
    const tool = new MessageTool({ workspace: WS, send_callback: send_cb, event_recorder: event_cb });
    const r = await tool.execute(
      { content: "hello" },
      { channel: "slack", chat_id: "C1" } as any,
    );
    expect(r).toContain("event_record_failed");
  });

  it("set_send_callback / set_event_recorder / start_turn / has_sent_in_turn", async () => {
    const tool = new MessageTool({ workspace: WS });
    const send_cb = vi.fn().mockResolvedValue(undefined);
    tool.set_send_callback(send_cb);
    const event_cb = vi.fn().mockResolvedValue({ event: { event_id: "ev1", detail_file: "detail.txt" } } as any);
    tool.set_event_recorder(event_cb);

    expect(tool.has_sent_in_turn()).toBe(false);
    tool.start_turn();
    await tool.execute({ content: "hi", phase: "progress" }, { channel: "slack", chat_id: "C1" } as any);
    expect(tool.has_sent_in_turn()).toBe(true);
  });

  it("event_recorder 성공 + detail_file 포함 → detail_file= 힌트 포함", async () => {
    const send_cb = vi.fn().mockResolvedValue(undefined);
    const event_cb = vi.fn().mockResolvedValue({
      event: {
        event_id: "ev1", run_id: "r1", task_id: "t1", agent_id: "a1",
        phase: "done", summary: "done", payload: {}, provider: "slack",
        channel: "slack", chat_id: "C1", source: "outbound", at: "now",
        detail_file: "/tmp/detail.txt",
      },
    });
    const tool = new MessageTool({ workspace: WS, send_callback: send_cb, event_recorder: event_cb });
    const r = await tool.execute(
      { content: "Completed task", phase: "done" },
      { channel: "slack", chat_id: "C1" } as any,
    );
    expect(r).toContain("detail_file=");
  });

  it("media 배열 포함 → media_items에 추가됨", async () => {
    const send_cb = vi.fn().mockResolvedValue(undefined);
    const tool = new MessageTool({ workspace: WS, send_callback: send_cb });
    await tool.execute(
      { content: "with media", media: ["https://example.com/img.png"] },
      { channel: "slack", chat_id: "C1" } as any,
    );
    const msg = send_cb.mock.calls[0][0];
    // URL 형식의 미디어는 to_local_media_item에서 처리됨
    expect(Array.isArray(msg.media)).toBe(true);
  });
});

// ══════════════════════════════════════════
// TaskStore — 미커버 분기
// ══════════════════════════════════════════

import { TaskStore } from "@src/agent/task-store.js";
import type { TaskState } from "@src/contracts.js";

function make_task(overrides?: Partial<TaskState>): TaskState {
  return {
    taskId: `task-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    status: "running",
    objective: "test objective",
    channel: "slack",
    chatId: "C123",
    memory: {},
    ...overrides,
  } as unknown as TaskState;
}

let tasks_dir: string;
let store: TaskStore;

describe("TaskStore — CRUD 전체", () => {
  beforeEach(async () => {
    tasks_dir = await mkdtemp(join(tmpdir(), "task-store-"));
    store = new TaskStore(tasks_dir);
  });

  afterEach(async () => {
    await rm(tasks_dir, { recursive: true, force: true });
  });

  it("upsert + get → 저장된 task 조회", async () => {
    const task = make_task();
    await store.upsert(task);
    const found = await store.get(task.taskId);
    expect(found?.taskId).toBe(task.taskId);
  });

  it("존재하지 않는 task_id → null 반환", async () => {
    const found = await store.get("nonexistent-id");
    expect(found).toBeNull();
  });

  it("list → 저장된 task 목록 반환", async () => {
    await store.upsert(make_task({ taskId: "t1" }));
    await store.upsert(make_task({ taskId: "t2" }));
    const list = await (store as any).list() as TaskState[];
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it("list_resumable → running/waiting 상태만 포함", async () => {
    await store.upsert(make_task({ taskId: "running-1", status: "running" }));
    await store.upsert(make_task({ taskId: "done-1", status: "completed" as any }));
    await store.upsert(make_task({ taskId: "wait-1", status: "waiting_user_input" as any }));
    const resumable = await (store as any).list_resumable() as TaskState[];
    const ids = resumable.map((t: TaskState) => t.taskId);
    expect(ids).toContain("running-1");
    expect(ids).toContain("wait-1");
    expect(ids).not.toContain("done-1");
  });

  it("upsert 업데이트 → status 변경됨", async () => {
    const task = make_task({ status: "running" });
    await store.upsert(task);
    await store.upsert({ ...task, status: "completed" as any });
    const found = await store.get(task.taskId);
    expect(found?.status).toBe("completed");
  });

  it("find_waiting_by_chat → waiting 상태 task 조회", async () => {
    const task = make_task({ status: "waiting_user_input" as any, channel: "slack", chatId: "C999" });
    await store.upsert(task);
    const found = await store.find_waiting_by_chat("slack", "C999");
    expect(found?.taskId).toBe(task.taskId);
  });

  it("find_waiting_by_chat → 매칭 없으면 null", async () => {
    const found = await store.find_waiting_by_chat("nonexistent", "C999");
    expect(found).toBeNull();
  });

  it("find_by_trigger_message_id → 빈 문자열 → null (early return)", async () => {
    const found = await store.find_by_trigger_message_id("slack", "");
    expect(found).toBeNull();
  });

  it("find_by_trigger_message_id → 매칭 task 조회", async () => {
    const task = make_task({ memory: { __trigger_message_id: "msg-trigger-123" } as any });
    await store.upsert(task);
    const found = await store.find_by_trigger_message_id("slack", "msg-trigger-123");
    expect(found?.taskId).toBe(task.taskId);
  });

  it("normalize_task — memory 기반 fallback (objective/channel/chatId)", async () => {
    const task = make_task({
      taskId: "mem-fallback",
      objective: "",
      channel: "",
      chatId: "",
      memory: { objective: "mem-obj", channel: "telegram", chat_id: "T-456" } as any,
    });
    await store.upsert(task);
    const found = await store.get("mem-fallback");
    expect(found?.objective).toBe("mem-obj");
    expect(found?.channel).toBe("telegram");
    expect(found?.chatId).toBe("T-456");
  });

  it("row_to_task: 잘못된 JSON payload_json → catch → null (L90)", async () => {
    // DB에 직접 잘못된 JSON 삽입
    const db_path = join(tasks_dir, "tasks.db");
    const task = make_task({ taskId: "bad-json-task" });
    await store.upsert(task); // 먼저 row 생성
    // payload_json을 잘못된 JSON으로 덮어씀
    with_sqlite(db_path, (db) => {
      db.prepare("UPDATE tasks SET payload_json = ? WHERE task_id = ?").run("{invalid json{{{", "bad-json-task");
    });
    // get() → row_to_task → JSON.parse throw → catch → null
    const found = await store.get("bad-json-task");
    expect(found).toBeNull();
  });
});
