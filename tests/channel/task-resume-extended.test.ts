/**
 * TaskResumeService — 미커버 경로 보충.
 * completed referenced task, non-resumable status, cancel_task null 결과,
 * expire_stale 만료 항목, resume_after_approval ctx 설정.
 */
import { describe, it, expect, vi } from "vitest";
import { TaskResumeService } from "@src/channels/task-resume.service.js";
import type { TaskState } from "@src/contracts.js";
import type { InboundMessage } from "@src/bus/types.js";
import type { AgentRuntimeLike } from "@src/agent/runtime.types.js";

function make_message(content: string, chat_id = "chat-1", thread_id?: string): InboundMessage {
  return {
    id: `msg-${Date.now()}`,
    provider: "telegram",
    channel: "telegram",
    sender_id: "user-1",
    chat_id,
    content,
    at: new Date().toISOString(),
    metadata: {},
    ...(thread_id ? { thread_id } : {}),
  };
}

function make_task(patch?: Partial<TaskState>): TaskState {
  return {
    taskId: "task-1",
    title: "Test Task",
    currentTurn: 3,
    maxTurns: 40,
    status: "waiting_user_input",
    currentStep: "execute",
    memory: { __updated_at_seoul: new Date().toISOString() },
    ...patch,
  };
}

function make_runtime(overrides?: Partial<AgentRuntimeLike>): AgentRuntimeLike {
  return {
    find_waiting_task: vi.fn().mockResolvedValue(null),
    find_task_by_trigger_message: vi.fn().mockResolvedValue(null),
    resume_task: vi.fn().mockResolvedValue(null),
    get_task: vi.fn().mockResolvedValue(null),
    cancel_task: vi.fn().mockResolvedValue(null),
    expire_stale_tasks: vi.fn().mockReturnValue([]),
    list_active_tasks: vi.fn().mockReturnValue([]),
    ...overrides,
  } as unknown as AgentRuntimeLike;
}

let info_spy: ReturnType<typeof vi.fn>;
let warn_spy: ReturnType<typeof vi.fn>;

const make_logger = () => {
  info_spy = vi.fn();
  warn_spy = vi.fn();
  return { debug: vi.fn(), info: info_spy, warn: warn_spy, error: vi.fn(), child: () => make_logger() } as never;
};

// ══════════════════════════════════════════
// try_resume — completed referenced task
// ══════════════════════════════════════════

describe("TaskResumeService.try_resume — completed 참조 태스크", () => {
  it("referenced status=completed → resumed=false + referenced_context 반환", async () => {
    const task = make_task({
      status: "completed",
      memory: {
        objective: "파일 분석",
        last_output: "분석 결과: OK",
        __updated_at_seoul: new Date().toISOString(),
      },
    });
    const runtime = make_runtime({
      find_task_by_trigger_message: vi.fn().mockResolvedValue(task),
    });
    const service = new TaskResumeService({ agent_runtime: runtime, logger: make_logger() });
    const result = await service.try_resume("telegram", make_message("후속 작업", "chat-1", "trigger-msg"));
    expect(result).not.toBeNull();
    expect(result!.resumed).toBe(false);
    expect(result!.previous_status).toBe("completed");
    expect(result!.referenced_context).toContain("파일 분석");
    expect(result!.referenced_context).toContain("분석 결과");
  });

  it("referenced_context: objective만 있을 때", async () => {
    const task = make_task({
      status: "completed",
      memory: { objective: "only-obj", __updated_at_seoul: new Date().toISOString() },
    });
    const runtime = make_runtime({
      find_task_by_trigger_message: vi.fn().mockResolvedValue(task),
    });
    const service = new TaskResumeService({ agent_runtime: runtime, logger: make_logger() });
    const result = await service.try_resume("telegram", make_message("follow-up", "chat-1", "ref-1"));
    expect(result!.referenced_context).toContain("only-obj");
    expect(result!.referenced_context).not.toContain("결과:");
  });

  it("referenced_context: last_output만 있을 때", async () => {
    const task = make_task({
      status: "completed",
      memory: { last_output: "output-only", __updated_at_seoul: new Date().toISOString() },
    });
    const runtime = make_runtime({
      find_task_by_trigger_message: vi.fn().mockResolvedValue(task),
    });
    const service = new TaskResumeService({ agent_runtime: runtime, logger: make_logger() });
    const result = await service.try_resume("telegram", make_message("follow-up", "chat-1", "ref-2"));
    expect(result!.referenced_context).toContain("output-only");
  });
});

describe("TaskResumeService.try_resume — 재개 불가 상태", () => {
  it("referenced status=cancelled → 재개 불가, return null", async () => {
    const task = make_task({ status: "cancelled" });
    const runtime = make_runtime({
      find_task_by_trigger_message: vi.fn().mockResolvedValue(task),
    });
    const service = new TaskResumeService({ agent_runtime: runtime, logger: make_logger() });
    const result = await service.try_resume("telegram", make_message("msg", "chat-1", "ref-3"));
    expect(result).toBeNull();
    expect(runtime.resume_task).not.toHaveBeenCalled();
  });

  it("! 접두사 명령 → skip", async () => {
    const runtime = make_runtime();
    const service = new TaskResumeService({ agent_runtime: runtime, logger: make_logger() });
    const result = await service.try_resume("telegram", make_message("!admin command"));
    expect(result).toBeNull();
  });

  it("reply_to로 ref_id 설정", async () => {
    const task = make_task({ status: "waiting_approval" });
    const resumed = make_task({ status: "running" });
    const runtime = make_runtime({
      find_task_by_trigger_message: vi.fn().mockResolvedValue(task),
      resume_task: vi.fn().mockResolvedValue(resumed),
    });
    const service = new TaskResumeService({ agent_runtime: runtime, logger: make_logger() });
    const msg = { ...make_message("승인"), reply_to: "orig-msg-id" };
    const result = await service.try_resume("telegram", msg);
    expect(result!.resumed).toBe(true);
  });

  it("failed task updatedAt 없음 → elapsed=Infinity → TTL 초과 → null", async () => {
    const task = make_task({
      status: "failed",
      memory: {}, // __updated_at_seoul 없음
    });
    const runtime = make_runtime({
      find_task_by_trigger_message: vi.fn().mockResolvedValue(task),
    });
    const service = new TaskResumeService({ agent_runtime: runtime, logger: make_logger() });
    const result = await service.try_resume("telegram", make_message("retry", "chat-1", "ref-x"));
    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════
// cancel_task / expire_stale
// ══════════════════════════════════════════

describe("TaskResumeService.cancel_task", () => {
  it("cancel_task null 결과 → 로깅 없음", async () => {
    const runtime = make_runtime({
      cancel_task: vi.fn().mockResolvedValue(null),
    });
    const logger = make_logger();
    const service = new TaskResumeService({ agent_runtime: runtime, logger });
    await service.cancel_task("task-1", "manual");
    expect(info_spy).not.toHaveBeenCalled();
  });

  it("cancel_task 성공 → 로깅 호출", async () => {
    const runtime = make_runtime({
      cancel_task: vi.fn().mockResolvedValue(make_task({ status: "cancelled" })),
    });
    const logger = make_logger();
    const service = new TaskResumeService({ agent_runtime: runtime, logger });
    await service.cancel_task("task-1", "manual");
    expect(info_spy).toHaveBeenCalledWith("task cancelled", expect.objectContaining({ task_id: "task-1" }));
  });
});

describe("TaskResumeService.expire_stale", () => {
  it("만료 태스크 없음 → 빈 배열, 로깅 없음", () => {
    const runtime = make_runtime({ expire_stale_tasks: vi.fn().mockReturnValue([]) });
    const logger = make_logger();
    const service = new TaskResumeService({ agent_runtime: runtime, logger });
    const r = service.expire_stale();
    expect(r).toEqual([]);
    expect(info_spy).not.toHaveBeenCalled();
  });

  it("만료 태스크 있음 → 로깅 호출 + 태스크 반환", () => {
    const expired = [make_task({ taskId: "expired-1", status: "cancelled" })];
    const runtime = make_runtime({ expire_stale_tasks: vi.fn().mockReturnValue(expired) });
    const logger = make_logger();
    const service = new TaskResumeService({ agent_runtime: runtime, logger });
    const r = service.expire_stale();
    expect(r).toEqual(expired);
    expect(info_spy).toHaveBeenCalledWith("expired_stale_tasks", expect.objectContaining({ count: 1 }));
  });
});

// ══════════════════════════════════════════
// resume_after_approval — ctx 설정 경로
// ══════════════════════════════════════════

describe("TaskResumeService.resume_after_approval — ctx 경로", () => {
  it("task.channel + task.chatId 있으면 ctx 전달", async () => {
    const task = {
      ...make_task({ status: "waiting_approval" }),
      channel: "slack",
      chatId: "C123",
    };
    const resumed = make_task({ status: "running" });
    const runtime = make_runtime({
      get_task: vi.fn().mockResolvedValue(task),
      resume_task: vi.fn().mockResolvedValue(resumed),
    });
    const service = new TaskResumeService({ agent_runtime: runtime, logger: make_logger() });
    const ok = await service.resume_after_approval("task-1", "tool result");
    expect(ok).toBe(true);
    expect(runtime.resume_task).toHaveBeenCalledWith(
      "task-1",
      expect.stringContaining("도구 실행 결과"),
      "approval_resolved",
      { channel: "slack", chat_id: "C123" },
    );
  });

  it("task.channel+chatId 없음 → ctx=undefined 전달", async () => {
    const task = make_task({ status: "waiting_approval" });
    const resumed = make_task({ status: "running" });
    const runtime = make_runtime({
      get_task: vi.fn().mockResolvedValue(task),
      resume_task: vi.fn().mockResolvedValue(resumed),
    });
    const service = new TaskResumeService({ agent_runtime: runtime, logger: make_logger() });
    await service.resume_after_approval("task-1", "result");
    expect(runtime.resume_task).toHaveBeenCalledWith(
      "task-1", expect.any(String), "approval_resolved", undefined,
    );
  });
});
