import { describe, it, expect, vi } from "vitest";
import { TaskHandler, type TaskAccess } from "@src/channels/commands/task.handler.ts";
import type { TaskState, AgentLoopState } from "@src/contracts.ts";
import type { CommandContext } from "@src/channels/commands/types.ts";
import type { ProcessEntry } from "@src/orchestration/process-tracker.js";

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

function make_process(overrides: Partial<ProcessEntry> = {}): ProcessEntry {
  return {
    run_id: "run-abc123",
    provider: "slack" as any,
    chat_id: "C001",
    alias: "assistant",
    sender_id: "U001",
    mode: "once" as any,
    status: "running" as any,
    started_at: new Date(Date.now() - 5000).toISOString(),
    subagent_ids: [],
    tool_calls_count: 3,
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

// ══════════════════════════════════════════
// format_active_list — process entries
// ══════════════════════════════════════════

describe("TaskHandler — format_active_list with process entries", () => {
  it("process 있음 → 실행 흐름 섹션 표시", async () => {
    const proc = make_process({ mode: "once" as any, status: "running" as any });
    const handler = new TaskHandler(make_access({
      list_active_processes: vi.fn().mockReturnValue([proc]),
    }));
    const ctx = make_ctx(["list"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("실행 흐름");
    expect(ctx.replies[0]).toContain("run-abc123");
  });

  it("process + loop_id/task_id/subagents 있음 → 상세 표시", async () => {
    const proc = make_process({
      loop_id: "loop-detail-123",
      task_id: "task:detail-456",
      subagent_ids: ["sub1", "sub2", "sub3"],
      tool_calls_count: 5,
    });
    const handler = new TaskHandler(make_access({
      list_active_processes: vi.fn().mockReturnValue([proc]),
    }));
    const ctx = make_ctx(["list"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("loop");
    expect(ctx.replies[0]).toContain("task");
    expect(ctx.replies[0]).toContain("sub");
  });

  it("process + task + loop 모두 있음 → 세 섹션 모두 표시", async () => {
    const proc = make_process();
    const task = make_task({ status: "running" as never });
    const loop = make_loop();
    const handler = new TaskHandler(make_access({
      list_active_processes: vi.fn().mockReturnValue([proc]),
      list_active_tasks: vi.fn().mockReturnValue([task]),
      list_active_loops: vi.fn().mockReturnValue([loop]),
    }));
    const ctx = make_ctx(["list"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("실행 흐름");
    expect(ctx.replies[0]).toContain("Task Loop");
    expect(ctx.replies[0]).toContain("Agent Loop");
  });
});

// ══════════════════════════════════════════
// /task status <run_id> — process 상세
// ══════════════════════════════════════════

describe("TaskHandler — /task status <run_id>", () => {
  it("process 찾음 → format_process_detail 표시", async () => {
    const proc = make_process({
      ended_at: new Date().toISOString(),
      loop_id: "lp-1",
      task_id: "task:t1",
      subagent_ids: ["sa1"],
      error: undefined,
    });
    const handler = new TaskHandler(make_access({
      get_process: vi.fn().mockReturnValue(proc),
    }));
    const ctx = make_ctx(["status", "run-abc123"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("프로세스 상세");
    expect(ctx.replies[0]).toContain("run-abc123");
    expect(ctx.replies[0]).toContain("tool_calls");
  });

  it("process error 있으면 → error 필드 표시", async () => {
    const proc = make_process({ error: "agent timeout after 30s" });
    const handler = new TaskHandler(make_access({
      get_process: vi.fn().mockReturnValue(proc),
    }));
    const ctx = make_ctx(["status", "run-error"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("error");
    expect(ctx.replies[0]).toContain("timeout");
  });

  it("process 진행 중 (ended_at 없음) → 진행중 duration", async () => {
    const proc = make_process({ ended_at: undefined });
    const handler = new TaskHandler(make_access({
      get_process: vi.fn().mockReturnValue(proc),
    }));
    const ctx = make_ctx(["status", "run-active"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("진행 중");
  });
});

// ══════════════════════════════════════════
// /task status — task_detail / loop_detail
// ══════════════════════════════════════════

describe("TaskHandler — format_task_detail / format_loop_detail", () => {
  it("task 상세: memory objective/channel 있음 → 표시", async () => {
    const task = make_task({
      memory: { objective: "파일 분석", channel: "slack", chat_id: "C001", __updated_at_seoul: "2026-01-01" },
      status: "waiting_user_input" as never,
      exitReason: "needs_info",
    });
    const handler = new TaskHandler(make_access({
      get_task: vi.fn().mockResolvedValue(task),
    }));
    const ctx = make_ctx(["status", "task-abc"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("Task 상세");
    expect(ctx.replies[0]).toContain("task-abc");
    expect(ctx.replies[0]).toContain("turn");
  });

  it("loop 상세: terminationReason 있음 → 표시", async () => {
    const loop = make_loop({
      terminationReason: "check_should_continue_false",
      status: "completed",
    });
    const handler = new TaskHandler(make_access({
      list_active_loops: vi.fn().mockReturnValue([loop]),
    }));
    const ctx = make_ctx(["status", "loop-xyz"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("Agent Loop 상세");
    expect(ctx.replies[0]).toContain("loop-xyz");
  });
});

// ══════════════════════════════════════════
// /task recent
// ══════════════════════════════════════════

describe("TaskHandler — /task recent", () => {
  it("완료된 프로세스 있음 → format_recent_list 표시", async () => {
    const proc = make_process({
      status: "completed" as any,
      ended_at: new Date().toISOString(),
      mode: "agent" as any,
    });
    const handler = new TaskHandler(make_access({
      list_recent_processes: vi.fn().mockReturnValue([proc]),
    }));
    const ctx = make_ctx(["recent"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("최근 완료 프로세스");
    expect(ctx.replies[0]).toContain("run-abc123");
  });

  it("에러 있는 프로세스 → ⚠ 표시", async () => {
    const proc = make_process({
      status: "failed" as any,
      ended_at: new Date().toISOString(),
      error: "timeout",
    });
    const handler = new TaskHandler(make_access({
      list_recent_processes: vi.fn().mockReturnValue([proc]),
    }));
    const ctx = make_ctx(["recent"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("⚠");
  });
});

describe("TaskHandler — /task recent 빈 목록", () => {
  it("최근 완료 프로세스 없음 → empty 메시지 반환", async () => {
    const handler = new TaskHandler(make_access({
      list_recent_processes: vi.fn().mockReturnValue([]),
    }));
    const ctx = make_ctx(["recent"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("최근 완료 프로세스가 없습니다");
  });
});

// ══════════════════════════════════════════
// /task cancel <id> — process 취소
// ══════════════════════════════════════════

describe("TaskHandler — /task cancel process cascade", () => {
  it("cancel_process 성공 → cascade 취소 완료 메시지", async () => {
    const handler = new TaskHandler(make_access({
      cancel_process: vi.fn().mockResolvedValue({ cancelled: true, details: "loop+task cancelled" }),
    }));
    const ctx = make_ctx(["cancel", "run-abc123"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("cascade 취소 완료");
    expect(ctx.replies[0]).toContain("run-abc123");
    expect(ctx.replies[0]).toContain("loop+task cancelled");
  });
});

// ══════════════════════════════════════════
// /task cancel all — process + task + loop
// ══════════════════════════════════════════

describe("TaskHandler — /task cancel all (extended)", () => {
  it("process + task + loop 전체 취소", async () => {
    const proc = make_process();
    const task = make_task({ status: "running" as never });
    const loop = make_loop();
    const cancel_process = vi.fn().mockResolvedValue({ cancelled: true, details: "ok" });
    const cancel_task = vi.fn().mockResolvedValue(make_task({ status: "cancelled" }));
    const stop_loop = vi.fn().mockReturnValue(make_loop({ status: "stopped" }));
    const handler = new TaskHandler(make_access({
      list_active_processes: vi.fn().mockReturnValue([proc]),
      list_active_tasks: vi.fn().mockReturnValue([task]),
      list_active_loops: vi.fn().mockReturnValue([loop]),
      cancel_process,
      cancel_task,
      stop_loop,
    }));
    const ctx = make_ctx(["cancel", "all"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("전체 작업 취소 완료");
    expect(ctx.replies[0]).toContain("3/3");
    expect(cancel_process).toHaveBeenCalledWith(proc.run_id);
    expect(cancel_task).toHaveBeenCalledWith(task.taskId, "cancelled_by_user_all");
    expect(stop_loop).toHaveBeenCalledWith(loop.loopId, "stopped_by_user_all");
  });

  it("전체 취소: 일부 실패해도 성공 카운트만 표시", async () => {
    const proc = make_process();
    const task = make_task({ status: "running" as never });
    const handler = new TaskHandler(make_access({
      list_active_processes: vi.fn().mockReturnValue([proc]),
      list_active_tasks: vi.fn().mockReturnValue([task]),
      cancel_process: vi.fn().mockResolvedValue({ cancelled: false, details: "" }),
      cancel_task: vi.fn().mockResolvedValue(make_task({ status: "cancelled" })),
    }));
    const ctx = make_ctx(["cancel", "전체"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("전체 작업 취소 완료");
    expect(ctx.replies[0]).toContain("1/2");
  });
});

// ══════════════════════════════════════════
// unknown 서브커맨드 + 한국어 이력/history
// ══════════════════════════════════════════

describe("TaskHandler — unknown 서브커맨드", () => {
  it("알 수 없는 서브커맨드 → 가이드 표시", async () => {
    const handler = new TaskHandler(make_access());
    const ctx = make_ctx(["foobar"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("/task");
  });

  it("한국어 이력/history 서브커맨드 → recent 동작", async () => {
    const proc = make_process({ status: "completed" as any, ended_at: new Date().toISOString() });
    const handler = new TaskHandler(make_access({
      list_recent_processes: vi.fn().mockReturnValue([proc]),
    }));
    const ctx_history = make_ctx(["history"]);
    await handler.handle(ctx_history);
    expect(ctx_history.replies[0]).toContain("최근 완료 프로세스");

    const ctx_recent = make_ctx(["이력"]);
    const handler2 = new TaskHandler(make_access({
      list_recent_processes: vi.fn().mockReturnValue([proc]),
    }));
    await handler2.handle(ctx_recent);
    expect(ctx_recent.replies[0]).toContain("최근 완료 프로세스");
  });
});
