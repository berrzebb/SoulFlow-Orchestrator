/**
 * TaskResumeService + 실제 AgentLoopStore + TaskStore 통합 테스트.
 *
 * Mock이 잡지 못하는 시나리오:
 * 1. 실제 TaskStore (SQLite) + AgentLoopStore 상태 전이
 * 2. 프로세스 재시작 후 task resume 동작
 * 3. 동시 resume 시도 시 MAX_RESUME_COUNT 보호
 * 4. TTL 만료 + 자동 취소 후 새 task 불가
 * 5. find_waiting_task가 실제 DB에서 올바른 task 반환
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "@src/agent/task-store.js";
import { AgentLoopStore } from "@src/agent/loop.service.js";
import { TaskResumeService } from "@src/channels/task-resume.service.js";
import type { TaskState } from "@src/contracts.js";
import type { InboundMessage } from "@src/bus/types.js";

let cleanup_dirs: string[] = [];
const noop_logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => noop_logger } as never;

function make_message(content: string, chat_id = "chat-1", provider = "telegram", thread_id?: string): InboundMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    provider, channel: provider,
    sender_id: "user-1", chat_id, content,
    at: new Date().toISOString(), metadata: {},
    ...(thread_id ? { thread_id } : {}),
  };
}

async function make_env() {
  const dir = await mkdtemp(join(tmpdir(), "task-resume-integ-"));
  cleanup_dirs.push(dir);
  const task_store = new TaskStore(join(dir, "tasks"));
  const loop_store = new AgentLoopStore({ task_store, logger: noop_logger });
  loop_store.set_session_id("session-1");
  await loop_store.initialize();
  return { dir, task_store, loop_store };
}

/** AgentRuntimeLike의 최소 구현체 — 실제 AgentLoopStore를 래핑 */
function make_runtime(loop_store: AgentLoopStore, task_store: TaskStore) {
  return {
    find_waiting_task: async (provider: string, chat_id: string) =>
      task_store.find_waiting_by_chat(provider, chat_id),
    find_task_by_trigger_message: async (provider: string, trigger_message_id: string) =>
      task_store.find_by_trigger_message_id(provider, trigger_message_id),
    resume_task: async (task_id: string, user_input?: string, reason?: string) =>
      loop_store.resume_task(task_id, user_input, reason),
    get_task: async (task_id: string) => loop_store.get_task(task_id),
    cancel_task: async (task_id: string, reason?: string) =>
      loop_store.cancel_task(task_id, reason),
    expire_stale_tasks: (ttl_ms?: number) => loop_store.expire_stale_tasks(ttl_ms),
    list_active_tasks: () =>
      loop_store.list_tasks().filter((t) => t.status !== "completed" && t.status !== "cancelled"),
  } as unknown as import("@src/agent/runtime.types.js").AgentRuntimeLike;
}

const DEFAULT_TRIGGER_MSG = "trigger-msg-1";

/** 실제 task state를 직접 삽입 (에이전트 실행 없이 상태 시뮬레이션) */
async function insert_task(task_store: TaskStore, patch?: Partial<TaskState>): Promise<TaskState> {
  const task: TaskState = {
    taskId: `task:${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: "Test Task",
    currentTurn: 3,
    maxTurns: 40,
    status: "waiting_user_input",
    currentStep: "execute",
    channel: "telegram",
    chatId: "chat-1",
    memory: {
      objective: "test objective",
      channel: "telegram",
      chat_id: "chat-1",
      __trigger_message_id: DEFAULT_TRIGGER_MSG,
      __updated_at_seoul: new Date().toISOString(),
    },
    ...patch,
  };
  await task_store.upsert(task);
  return task;
}

afterEach(async () => {
  for (const d of cleanup_dirs) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
  cleanup_dirs = [];
});

describe("TaskResumeService 통합 (실제 SQLite)", () => {
  it("대기 Task을 찾아 resume하면 running 상태로 전이 + DB에 persist", async () => {
    const { dir, task_store, loop_store } = await make_env();
    const task = await insert_task(task_store);
    // AgentLoopStore도 메모리에 로드
    await loop_store.initialize();

    const runtime = make_runtime(loop_store, task_store);
    const service = new TaskResumeService({ agent_runtime: runtime, logger: noop_logger });

    const result = await service.try_resume("telegram", make_message("3번", "chat-1", "telegram", DEFAULT_TRIGGER_MSG));
    expect(result).not.toBeNull();
    expect(result!.resumed).toBe(true);
    expect(result!.task_id).toBe(task.taskId);

    // DB에서 직접 확인
    const db_task = await task_store.get(task.taskId);
    expect(db_task!.status).toBe("running");
    expect(db_task!.memory.__user_input).toBe("3번");
  });

  it("프로세스 재시작 후에도 대기 Task을 찾아 resume 가능", async () => {
    const dir = await mkdtemp(join(tmpdir(), "task-restart-"));
    cleanup_dirs.push(dir);

    // 첫 번째 프로세스 — task 생성
    const store1 = new TaskStore(join(dir, "tasks"));
    const task = await insert_task(store1, { status: "waiting_user_input" });

    // 두 번째 프로세스 — 새 인스턴스
    const store2 = new TaskStore(join(dir, "tasks"));
    const loop2 = new AgentLoopStore({ task_store: store2, logger: noop_logger });
    loop2.set_session_id("session-2");
    await loop2.initialize();

    const runtime = make_runtime(loop2, store2);
    const service = new TaskResumeService({ agent_runtime: runtime, logger: noop_logger });

    const result = await service.try_resume("telegram", make_message("재시작 후 입력", "chat-1", "telegram", DEFAULT_TRIGGER_MSG));
    expect(result).not.toBeNull();
    expect(result!.resumed).toBe(true);

    // DB에서 확인
    const db_task = await store2.get(task.taskId);
    expect(db_task!.status).toBe("running");
    expect(db_task!.memory.__user_input).toBe("재시작 후 입력");
  });

  it("MAX_RESUME_COUNT(3) 초과 시 자동 취소", async () => {
    const { task_store, loop_store } = await make_env();
    const task = await insert_task(task_store);
    await loop_store.initialize();

    const runtime = make_runtime(loop_store, task_store);
    const service = new TaskResumeService({ agent_runtime: runtime, logger: noop_logger });

    // 3번 resume — 각각 running으로 전이 후 다시 waiting으로 되돌림
    for (let i = 0; i < 3; i++) {
      const r = await service.try_resume("telegram", make_message(`입력-${i}`, "chat-1", "telegram", DEFAULT_TRIGGER_MSG));
      expect(r?.resumed).toBe(true);
      // 다시 waiting 상태로 (실제로는 에이전트가 waiting으로 전이시킴)
      const current = loop_store.get_task(task.taskId)!;
      current.status = "waiting_user_input";
      await task_store.upsert(current);
    }

    // 4번째 resume — MAX_RESUME_COUNT 초과
    // 먼저 메모리에 최신 상태 로드 (DB에서)
    const loop2 = new AgentLoopStore({ task_store, logger: noop_logger });
    loop2.set_session_id("session-1");
    await loop2.initialize();
    const runtime2 = make_runtime(loop2, task_store);
    const service2 = new TaskResumeService({ agent_runtime: runtime2, logger: noop_logger });

    const result = await service2.try_resume("telegram", make_message("4번째", "chat-1", "telegram", DEFAULT_TRIGGER_MSG));
    // resume_task가 cancelled 상태를 반환 → TaskResumeService는 null 반환
    expect(result).toBeNull();

    // DB에서 확인 — cancelled 상태
    const db_task = await task_store.get(task.taskId);
    expect(db_task!.status).toBe("cancelled");
    expect(db_task!.exitReason).toBe("max_resume_exceeded");
  });

  it("다른 채팅의 Task은 매칭되지 않음", async () => {
    const { task_store, loop_store } = await make_env();
    await insert_task(task_store, { chatId: "other-chat", memory: { chat_id: "other-chat", channel: "telegram", __updated_at_seoul: new Date().toISOString() } });
    await loop_store.initialize();

    const runtime = make_runtime(loop_store, task_store);
    const service = new TaskResumeService({ agent_runtime: runtime, logger: noop_logger });

    const result = await service.try_resume("telegram", make_message("hello", "chat-1"));
    expect(result).toBeNull();
  });

  it("completed Task은 resume 불가", async () => {
    const { task_store, loop_store } = await make_env();
    await insert_task(task_store, { status: "completed" });
    await loop_store.initialize();

    const runtime = make_runtime(loop_store, task_store);
    const service = new TaskResumeService({ agent_runtime: runtime, logger: noop_logger });

    const result = await service.try_resume("telegram", make_message("추가 입력"));
    expect(result).toBeNull();
  });

  it("failed Task은 TTL 이내이고 reference가 있으면 retry_with_enrichment로 resume", async () => {
    const { task_store, loop_store } = await make_env();
    await insert_task(task_store, {
      status: "failed",
      memory: {
        channel: "telegram", chat_id: "chat-1",
        __trigger_message_id: DEFAULT_TRIGGER_MSG,
        __updated_at_seoul: new Date().toISOString(),
      },
    });
    await loop_store.initialize();

    const runtime = make_runtime(loop_store, task_store);
    const service = new TaskResumeService({ agent_runtime: runtime, logger: noop_logger });

    const result = await service.try_resume("telegram", make_message("재시도 데이터", "chat-1", "telegram", DEFAULT_TRIGGER_MSG));
    expect(result).not.toBeNull();
    expect(result!.previous_status).toBe("failed");
  });

  it("failed Task이 TTL(30분) 초과하면 무시", async () => {
    const { task_store, loop_store } = await make_env();
    await insert_task(task_store, {
      status: "failed",
      memory: {
        channel: "telegram", chat_id: "chat-1",
        __trigger_message_id: DEFAULT_TRIGGER_MSG,
        __updated_at_seoul: new Date(Date.now() - 31 * 60_000).toISOString(),
      },
    });
    await loop_store.initialize();

    const runtime = make_runtime(loop_store, task_store);
    const service = new TaskResumeService({ agent_runtime: runtime, logger: noop_logger });

    const result = await service.try_resume("telegram", make_message("늦은 재시도", "chat-1", "telegram", DEFAULT_TRIGGER_MSG));
    expect(result).toBeNull();
  });

  it("동시 resume 시도가 직렬화됨", async () => {
    const { task_store, loop_store } = await make_env();
    const task = await insert_task(task_store);
    await loop_store.initialize();

    const runtime = make_runtime(loop_store, task_store);
    const service = new TaskResumeService({ agent_runtime: runtime, logger: noop_logger });

    // 동시에 2개 resume 시도
    const [r1, r2] = await Promise.all([
      service.try_resume("telegram", make_message("first", "chat-1", "telegram", DEFAULT_TRIGGER_MSG)),
      service.try_resume("telegram", make_message("second", "chat-1", "telegram", DEFAULT_TRIGGER_MSG)),
    ]);

    // 하나만 성공, 나머지는 이미 running 상태
    const results = [r1, r2].filter(Boolean);
    expect(results.length).toBeGreaterThanOrEqual(1);

    // DB에서 확인 — running 상태
    const db_task = await task_store.get(task.taskId);
    expect(db_task!.status).toBe("running");
  });

  it("expire_stale_tasks 후 expired task은 resume 불가", async () => {
    const { task_store, loop_store } = await make_env();
    const old_time = new Date(Date.now() - 700_000).toISOString();
    await insert_task(task_store, {
      memory: {
        channel: "telegram", chat_id: "chat-1",
        __updated_at_seoul: old_time,
      },
    });
    await loop_store.initialize();

    // TTL 600초 → 이 task은 만료
    loop_store.expire_stale_tasks(600_000);

    const runtime = make_runtime(loop_store, task_store);
    const service = new TaskResumeService({ agent_runtime: runtime, logger: noop_logger });

    const result = await service.try_resume("telegram", make_message("만료된 task 입력"));
    expect(result).toBeNull();
  });
});
