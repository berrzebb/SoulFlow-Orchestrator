import { describe, it, expect, vi } from "vitest";
import { TaskHandler, type TaskAccess } from "@src/channels/commands/task.handler.ts";
import type { TaskState, AgentLoopState } from "@src/contracts.ts";
import type { CommandContext } from "@src/channels/commands/types.ts";

function make_task(patch?: Partial<TaskState>): TaskState {
  return {
    taskId: "task-abc",
    title: "ChannelTask:assistant",
    currentTurn: 5,
    maxTurns: 40,
    status: "waiting_user_input",
    currentStep: "execute",
    memory: { objective: "추천곡 찾아서 재생", channel: "telegram", chat_id: "chat-1" },
    ...patch,
  };
}

function make_loop(patch?: Partial<AgentLoopState>): AgentLoopState {
  return {
    loopId: "loop-xyz",
    agentId: "agent-1",
    objective: "웹 검색 후 요약 보고서 작성",
    currentTurn: 3,
    maxTurns: 20,
    checkShouldContinue: true,
    status: "running",
    ...patch,
  };
}

function make_access(overrides?: Partial<TaskAccess>): TaskAccess {
  return {
    find_waiting_task: vi.fn().mockResolvedValue(null),
    get_task: vi.fn().mockResolvedValue(null),
    cancel_task: vi.fn().mockResolvedValue(null),
    list_active_tasks: vi.fn().mockReturnValue([]),
    list_active_loops: vi.fn().mockReturnValue([]),
    stop_loop: vi.fn().mockReturnValue(null),
    list_active_processes: vi.fn().mockReturnValue([]),
    list_recent_processes: vi.fn().mockReturnValue([]),
    get_process: vi.fn().mockReturnValue(null),
    cancel_process: vi.fn().mockResolvedValue({ cancelled: false, details: "" }),
    ...overrides,
  };
}

function make_ctx(args: string[] = [], provider = "telegram", chat_id = "chat-1"): CommandContext & { replies: string[] } {
  const replies: string[] = [];
  return {
    provider: provider as never,
    message: {
      id: "msg-1", provider, channel: provider,
      sender_id: "user-1", chat_id, content: `/task ${args.join(" ")}`,
      at: new Date().toISOString(), metadata: {},
    },
    command: { raw: `/task ${args.join(" ")}`, name: "task", args, args_lower: args.map(a => a.toLowerCase()) },
    text: `/task ${args.join(" ")}`,
    send_reply: async (content: string) => { replies.push(content); },
    replies,
  };
}

describe("TaskHandler", () => {
  it("can_handle — /task 명령 인식", () => {
    const handler = new TaskHandler(make_access());
    const ctx = make_ctx();
    expect(handler.can_handle(ctx)).toBe(true);
  });

  it("can_handle — 관련없는 명령 무시", () => {
    const handler = new TaskHandler(make_access());
    const ctx = make_ctx();
    ctx.command = { raw: "/help", name: "help", args: [], args_lower: [] };
    expect(handler.can_handle(ctx)).toBe(false);
  });

  it("/task (인자 없음) — 세부 기능 가이드 표시", async () => {
    const handler = new TaskHandler(make_access());
    const ctx = make_ctx();
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("/task list");
    expect(ctx.replies[0]).toContain("/task status");
    expect(ctx.replies[0]).toContain("/task cancel");
    expect(ctx.replies[0]).toContain("/task recent");
  });

  it("/task list — 활성 작업 없으면 안내 메시지", async () => {
    const handler = new TaskHandler(make_access());
    const ctx = make_ctx(["list"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("활성 작업이 없습니다");
  });

  it("/task list — Task Loop 활성 목록 표시", async () => {
    const task = make_task({ status: "running" as never });
    const handler = new TaskHandler(make_access({
      list_active_tasks: vi.fn().mockReturnValue([task]),
    }));

    const ctx = make_ctx(["list"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("활성 작업 목록");
    expect(ctx.replies[0]).toContain("task-abc");
    expect(ctx.replies[0]).toContain("Task Loop");
  });

  it("/task list — Agent Loop 활성 목록 표시", async () => {
    const loop = make_loop();
    const handler = new TaskHandler(make_access({
      list_active_loops: vi.fn().mockReturnValue([loop]),
    }));

    const ctx = make_ctx(["list"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("활성 작업 목록");
    expect(ctx.replies[0]).toContain("loop-xyz");
    expect(ctx.replies[0]).toContain("Agent Loop");
    expect(ctx.replies[0]).toContain("웹 검색 후 요약 보고서 작성");
  });

  it("/task list — Task + Agent Loop 모두 표시", async () => {
    const task = make_task({ status: "running" as never });
    const loop = make_loop();
    const handler = new TaskHandler(make_access({
      list_active_tasks: vi.fn().mockReturnValue([task]),
      list_active_loops: vi.fn().mockReturnValue([loop]),
    }));

    const ctx = make_ctx(["list"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("Task Loop");
    expect(ctx.replies[0]).toContain("Agent Loop");
    expect(ctx.replies[0]).toContain("task-abc");
    expect(ctx.replies[0]).toContain("loop-xyz");
  });

  it("/task status <id> — Task 상세 표시", async () => {
    const task = make_task({ memory: { objective: "추천곡 찾기", mode: "task_loop" } });
    const handler = new TaskHandler(make_access({
      get_task: vi.fn().mockResolvedValue(task),
    }));

    const ctx = make_ctx(["status", "task-abc"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("Task 상세");
    expect(ctx.replies[0]).toContain("task-abc");
    expect(ctx.replies[0]).toContain("objective");
  });

  it("/task status <id> — Agent Loop 상세 표시", async () => {
    const loop = make_loop();
    const handler = new TaskHandler(make_access({
      list_active_loops: vi.fn().mockReturnValue([loop]),
    }));

    const ctx = make_ctx(["status", "loop-xyz"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("Agent Loop 상세");
    expect(ctx.replies[0]).toContain("loop-xyz");
    expect(ctx.replies[0]).toContain("agent-1");
  });

  it("/task status — ID 없으면 사용법 안내", async () => {
    const handler = new TaskHandler(make_access());
    const ctx = make_ctx(["status"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("/task status");
  });

  it("/task status <없는 id> — 작업 없음 안내", async () => {
    const handler = new TaskHandler(make_access());
    const ctx = make_ctx(["status", "not-exist"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("찾을 수 없습니다");
  });

  it("/task cancel <id> — Task 취소", async () => {
    const cancelled = make_task({ status: "cancelled" });
    const handler = new TaskHandler(make_access({
      cancel_task: vi.fn().mockResolvedValue(cancelled),
    }));

    const ctx = make_ctx(["cancel", "task-abc"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("취소되었습니다");
    expect(ctx.replies[0]).toContain("cancelled");
  });

  it("/task cancel <id> — Agent Loop 중지", async () => {
    const stopped = make_loop({ status: "stopped" });
    const handler = new TaskHandler(make_access({
      stop_loop: vi.fn().mockReturnValue(stopped),
    }));

    const ctx = make_ctx(["cancel", "loop-xyz"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("루프가 중지되었습니다");
    expect(ctx.replies[0]).toContain("stopped");
  });

  it("/task cancel — ID 없으면 사용법 안내", async () => {
    const handler = new TaskHandler(make_access());
    const ctx = make_ctx(["cancel"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("/task cancel");
  });

  it("/task cancel <없는 id> — 취소 대상 없음 안내", async () => {
    const handler = new TaskHandler(make_access());
    const ctx = make_ctx(["cancel", "no-task"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("찾을 수 없습니다");
  });

  it("한국어 별칭 지원 — /task 취소, /task 상태, /task 목록", async () => {
    const handler = new TaskHandler(make_access());

    const ctx_list = make_ctx(["목록"]);
    await handler.handle(ctx_list);
    expect(ctx_list.replies[0]).toContain("활성 작업이 없습니다");

    const ctx_status = make_ctx(["상태"]);
    await handler.handle(ctx_status);
    expect(ctx_status.replies[0]).toContain("/task status");

    const ctx_cancel = make_ctx(["취소"]);
    await handler.handle(ctx_cancel);
    expect(ctx_cancel.replies[0]).toContain("/task cancel");
  });

  it("/task cancel all — 전체 작업 일괄 취소", async () => {
    const task = make_task({ status: "running" as never });
    const loop = make_loop();
    const cancel_task = vi.fn().mockResolvedValue(make_task({ status: "cancelled" }));
    const stop_loop = vi.fn().mockReturnValue(make_loop({ status: "stopped" }));
    const handler = new TaskHandler(make_access({
      list_active_tasks: vi.fn().mockReturnValue([task]),
      list_active_loops: vi.fn().mockReturnValue([loop]),
      cancel_task,
      stop_loop,
    }));

    const ctx = make_ctx(["cancel", "all"]);
    await handler.handle(ctx);

    expect(cancel_task).toHaveBeenCalledWith("task-abc", "cancelled_by_user_all");
    expect(stop_loop).toHaveBeenCalledWith("loop-xyz", "stopped_by_user_all");
    expect(ctx.replies[0]).toContain("전체 작업 취소 완료");
    expect(ctx.replies[0]).toContain("Task: 1");
    expect(ctx.replies[0]).toContain("Agent Loop: 1");
  });

  it("/task cancel all — 활성 작업 없으면 안내", async () => {
    const handler = new TaskHandler(make_access());
    const ctx = make_ctx(["cancel", "all"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("취소할 활성 작업이 없습니다");
  });

  it("긴 objective는 60자로 잘림", async () => {
    const long_text = "A".repeat(100);
    const loop = make_loop({ objective: long_text });
    const handler = new TaskHandler(make_access({
      list_active_loops: vi.fn().mockReturnValue([loop]),
    }));

    const ctx = make_ctx(["list"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("AAA...");
    expect(ctx.replies[0]).not.toContain(long_text);
  });
});
