import { describe, it, expect, vi } from "vitest";
import { TaskResumeService } from "@src/channels/task-resume.service.ts";
import type { TaskState } from "@src/contracts.ts";
import type { InboundMessage } from "@src/bus/types.ts";
import type { AgentRuntimeLike } from "@src/agent/runtime.types.ts";

function make_message(content: string, chat_id = "chat-1"): InboundMessage {
  return {
    id: `msg-${Date.now()}`,
    provider: "telegram",
    channel: "telegram",
    sender_id: "user-1",
    chat_id,
    content,
    at: new Date().toISOString(),
    metadata: {},
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
    resume_task: vi.fn().mockResolvedValue(null),
    get_task: vi.fn().mockResolvedValue(null),
    cancel_task: vi.fn().mockResolvedValue(null),
    expire_stale_tasks: vi.fn().mockReturnValue([]),
    list_active_tasks: vi.fn().mockReturnValue([]),
    ...overrides,
  } as unknown as AgentRuntimeLike;
}

const noop_logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => noop_logger } as never;

describe("TaskResumeService", () => {
  it("대기 Task이 있으면 재개하고 결과 반환", async () => {
    const task = make_task();
    const resumed = make_task({ status: "running" });
    const runtime = make_runtime({
      find_waiting_task: vi.fn().mockResolvedValue(task),
      resume_task: vi.fn().mockResolvedValue(resumed),
    });

    const service = new TaskResumeService({ agent_runtime: runtime, logger: noop_logger });
    const result = await service.try_resume("telegram", make_message("3번"));

    expect(result).not.toBeNull();
    expect(result!.resumed).toBe(true);
    expect(result!.task_id).toBe("task-1");
    expect(result!.previous_status).toBe("waiting_user_input");
    expect(runtime.resume_task).toHaveBeenCalledWith("task-1", "3번", "user_input_received");
  });

  it("대기 Task이 없으면 null 반환", async () => {
    const runtime = make_runtime();
    const service = new TaskResumeService({ agent_runtime: runtime, logger: noop_logger });

    const result = await service.try_resume("telegram", make_message("안녕"));
    expect(result).toBeNull();
  });

  it("슬래시 명령은 건너뛰기", async () => {
    const task = make_task();
    const runtime = make_runtime({
      find_waiting_task: vi.fn().mockResolvedValue(task),
    });

    const service = new TaskResumeService({ agent_runtime: runtime, logger: noop_logger });
    const result = await service.try_resume("telegram", make_message("/help"));

    expect(result).toBeNull();
    expect(runtime.find_waiting_task).not.toHaveBeenCalled();
  });

  it("빈 메시지는 건너뛰기", async () => {
    const runtime = make_runtime();
    const service = new TaskResumeService({ agent_runtime: runtime, logger: noop_logger });

    const result = await service.try_resume("telegram", make_message(""));
    expect(result).toBeNull();
  });

  it("failed Task은 TTL 이내면 retry_with_enrichment로 재개", async () => {
    const task = make_task({
      status: "failed",
      memory: { __updated_at_seoul: new Date().toISOString() },
    });
    const resumed = make_task({ status: "running" });
    const runtime = make_runtime({
      find_waiting_task: vi.fn().mockResolvedValue(task),
      resume_task: vi.fn().mockResolvedValue(resumed),
    });

    const service = new TaskResumeService({ agent_runtime: runtime, logger: noop_logger });
    const result = await service.try_resume("telegram", make_message("파일 다시 첨부합니다"));

    expect(result).not.toBeNull();
    expect(result!.previous_status).toBe("failed");
    expect(runtime.resume_task).toHaveBeenCalledWith("task-1", "파일 다시 첨부합니다", "retry_with_enrichment");
  });

  it("failed Task이 TTL 초과하면 무시", async () => {
    const old_time = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    const task = make_task({
      status: "failed",
      memory: { __updated_at_seoul: old_time },
    });
    const runtime = make_runtime({
      find_waiting_task: vi.fn().mockResolvedValue(task),
    });

    const service = new TaskResumeService({ agent_runtime: runtime, logger: noop_logger });
    const result = await service.try_resume("telegram", make_message("재시도"));

    expect(result).toBeNull();
    expect(runtime.resume_task).not.toHaveBeenCalled();
  });

  it("resume_task가 running 아닌 상태를 반환하면 null", async () => {
    const task = make_task();
    const runtime = make_runtime({
      find_waiting_task: vi.fn().mockResolvedValue(task),
      resume_task: vi.fn().mockResolvedValue(make_task({ status: "cancelled" })),
    });

    const service = new TaskResumeService({ agent_runtime: runtime, logger: noop_logger });
    const result = await service.try_resume("telegram", make_message("3번"));

    expect(result).toBeNull();
  });
});

describe("TaskResumeService.resume_after_approval", () => {
  it("waiting_approval 상태의 Task을 재개하고 도구 결과 주입", async () => {
    const task = make_task({ status: "waiting_approval" });
    const resumed = make_task({ status: "running" });
    const runtime = make_runtime({
      get_task: vi.fn().mockResolvedValue(task),
      resume_task: vi.fn().mockResolvedValue(resumed),
    });

    const service = new TaskResumeService({ agent_runtime: runtime, logger: noop_logger });
    const ok = await service.resume_after_approval("task-1", "exec 도구 결과: 성공");

    expect(ok).toBe(true);
    expect(runtime.resume_task).toHaveBeenCalledWith(
      "task-1",
      expect.stringContaining("도구 실행 결과"),
      "approval_resolved",
    );
  });

  it("Task이 waiting_approval이 아니면 false 반환", async () => {
    const task = make_task({ status: "running" });
    const runtime = make_runtime({
      get_task: vi.fn().mockResolvedValue(task),
    });

    const service = new TaskResumeService({ agent_runtime: runtime, logger: noop_logger });
    const ok = await service.resume_after_approval("task-1", "result");

    expect(ok).toBe(false);
    expect(runtime.resume_task).not.toHaveBeenCalled();
  });

  it("Task이 존재하지 않으면 false 반환", async () => {
    const runtime = make_runtime();
    const service = new TaskResumeService({ agent_runtime: runtime, logger: noop_logger });
    const ok = await service.resume_after_approval("not-exist", "result");

    expect(ok).toBe(false);
  });

  it("resume_task가 running 외 상태를 반환하면 false", async () => {
    const task = make_task({ status: "waiting_approval" });
    const runtime = make_runtime({
      get_task: vi.fn().mockResolvedValue(task),
      resume_task: vi.fn().mockResolvedValue(make_task({ status: "failed" })),
    });

    const service = new TaskResumeService({ agent_runtime: runtime, logger: noop_logger });
    const ok = await service.resume_after_approval("task-1", "result");

    expect(ok).toBe(false);
  });
});
