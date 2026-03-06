/**
 * HITL 복합 워크플로우 E2E 테스트
 *
 * 전체 파이프라인을 검증:
 *   1. 사용자 메시지 → ChannelManager → OrchestrationService → waiting_user_input
 *   2. 사용자 선택 → TaskResumeService → resume_task → OrchestrationService → completed
 *   3. /task 명령으로 대기 작업 조회·취소
 *   4. 엣지 케이스 (슬래시 명령, TTL 초과, completed 재개 불가 등)
 *
 * Mock 경계: OrchestrationService의 execute()만 모의 — 나머지(TaskResumeService, ChannelManager 등)는 실제 서비스.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import type { InboundMessage, OutboundMessage } from "@src/bus/types.ts";
import type { ChannelProvider, ChannelRegistryLike } from "@src/channels/types.ts";
import type { OrchestrationRequest, OrchestrationResult } from "@src/orchestration/types.ts";
import type { OrchestrationService } from "@src/orchestration/service.ts";
import type { DispatchService } from "@src/channels/dispatch.service.ts";
import type { TaskState, AgentLoopState } from "@src/contracts.ts";
import { MessageBus } from "@src/bus/service.ts";
import { ChannelManager } from "@src/channels/manager.ts";
import { CommandRouter } from "@src/channels/commands/router.ts";
import { TaskHandler, type TaskAccess } from "@src/channels/commands/task.handler.ts";
import { TaskResumeService } from "@src/channels/task-resume.service.ts";
import { ApprovalService } from "@src/channels/approval.service.ts";
import { SessionRecorder } from "@src/channels/session-recorder.ts";
import { MediaCollector } from "@src/channels/media-collector.ts";
import {
  FakeChannelRegistry,
  FakeDispatchService,
  FakeApprovalService,
  create_test_channel_config,
  create_noop_logger,
} from "@helpers/harness.ts";

/* ── Stateful Mock Runtime ─────────────────────────────── */

/** AgentRuntimeLike의 task 관련 메서드만 구현한 stateful mock. */
class MockTaskRuntime {
  private tasks = new Map<string, TaskState>();

  /** 테스트용: 외부에서 직접 task를 seed. */
  seed_task(task: TaskState): void {
    this.tasks.set(task.taskId, { ...task });
  }

  async find_waiting_task(provider: string, chat_id: string): Promise<TaskState | null> {
    for (const t of this.tasks.values()) {
      const mem = t.memory as Record<string, unknown>;
      if (String(mem.channel || "") === provider && String(mem.chat_id || "") === chat_id) {
        if (["waiting_user_input", "waiting_approval", "failed"].includes(t.status)) {
          return { ...t };
        }
      }
    }
    return null;
  }

  async resume_task(task_id: string, user_input?: string, reason?: string): Promise<TaskState | null> {
    const task = this.tasks.get(task_id);
    if (!task) return null;
    if (task.status === "completed" || task.status === "cancelled") return { ...task };
    if (user_input !== undefined) {
      task.memory.__user_input = user_input;
      task.memory.__resumed_at = new Date().toISOString();
    }
    task.status = "running";
    task.exitReason = reason || "resumed";
    this.tasks.set(task_id, task);
    return { ...task };
  }

  async get_task(task_id: string): Promise<TaskState | null> {
    const t = this.tasks.get(task_id);
    return t ? { ...t } : null;
  }

  async cancel_task(task_id: string, reason?: string): Promise<TaskState | null> {
    const task = this.tasks.get(task_id);
    if (!task) return null;
    task.status = "cancelled";
    task.exitReason = reason || "cancelled_by_request";
    this.tasks.set(task_id, task);
    return { ...task };
  }

  /** 테스트 후 task 상태를 업데이트 (orchestration 결과 시뮬레이션). */
  update_task(task_id: string, patch: Partial<TaskState>): void {
    const task = this.tasks.get(task_id);
    if (!task) return;
    Object.assign(task, patch);
    this.tasks.set(task_id, task);
  }

  list_active_tasks(): TaskState[] {
    return [...this.tasks.values()].filter((t) => !["completed", "cancelled"].includes(t.status));
  }

  expire_stale_tasks(_ttl_ms?: number): TaskState[] {
    return [];
  }

  list_active_loops(): AgentLoopState[] {
    return [];
  }

  stop_loop(_loop_id: string, _reason?: string): AgentLoopState | null {
    return null;
  }
}

/* ── Stateful Mock Orchestration ───────────────────────── */

type OrchestrationHandler = (req: OrchestrationRequest) => Promise<OrchestrationResult>;

class MockOrchestrationService {
  handler: OrchestrationHandler;
  readonly calls: OrchestrationRequest[] = [];

  constructor(handler: OrchestrationHandler) {
    this.handler = handler;
  }

  async execute(req: OrchestrationRequest): Promise<OrchestrationResult> {
    this.calls.push(req);
    return this.handler(req);
  }
}

/* ── Harness ───────────────────────────────────────────── */

type HITLHarness = {
  workspace: string;
  manager: ChannelManager;
  registry: FakeChannelRegistry;
  dispatch: FakeDispatchService;
  orchestration: MockOrchestrationService;
  runtime: MockTaskRuntime;
  cleanup: () => Promise<void>;
};

async function create_hitl_harness(handler: OrchestrationHandler): Promise<HITLHarness> {
  const workspace = await mkdtemp(join(tmpdir(), "hitl-test-"));
  const logger = create_noop_logger();

  const registry = new FakeChannelRegistry();
  const dispatch = new FakeDispatchService(registry);
  const orchestration = new MockOrchestrationService(handler);
  const approval = new FakeApprovalService() as unknown as ApprovalService;
  const runtime = new MockTaskRuntime();

  const task_resume = new TaskResumeService({
    agent_runtime: runtime as never,
    logger,
  });

  const task_access: TaskAccess = {
    find_waiting_task: (p: string, c: string) => runtime.find_waiting_task(p, c),
    get_task: (id: string) => runtime.get_task(id),
    cancel_task: (id: string, r?: string) => runtime.cancel_task(id, r),
    list_active_tasks: () => runtime.list_active_tasks(),
    list_active_loops: () => runtime.list_active_loops(),
    stop_loop: (id: string, r?: string) => runtime.stop_loop(id, r),
    list_active_processes: () => [],
    list_recent_processes: () => [],
    get_process: () => null,
    cancel_process: async () => ({ cancelled: false, details: "" }),
  };

  const command_router = new CommandRouter([
    new TaskHandler(task_access),
  ]);

  const recorder = new SessionRecorder({
    sessions: null,
    daily_memory: null,
    sanitize_for_storage: (t: string) => t,
    logger,
  });
  const media = new MediaCollector({ workspace_dir: workspace, tokens: {} });

  const config = { ...create_test_channel_config(), autoReply: true };
  const bus = new MessageBus();

  const manager = new ChannelManager({
    bus,
    registry: registry as unknown as ChannelRegistryLike,
    dispatch: dispatch as unknown as DispatchService,
    command_router,
    orchestration: orchestration as unknown as OrchestrationService,
    approval,
    task_resume,
    session_recorder: recorder,
    media_collector: media,
    providers: {} as never,
    config,
    workspace_dir: workspace,
    logger,
  });

  const cleanup = async () => {
    await manager.stop();
    for (let i = 0; i < 4; i++) {
      try { await rm(workspace, { recursive: true, force: true }); return; }
      catch { await new Promise<void>((r) => setTimeout(r, 30 * (i + 1))); }
    }
  };

  return { workspace, manager, registry, dispatch, orchestration, runtime, cleanup };
}

function msg(content: string, patch?: Partial<InboundMessage>): InboundMessage {
  const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    id, provider: "telegram", channel: "telegram",
    sender_id: "user-1", chat_id: "chat-1",
    content, at: new Date().toISOString(),
    media: [], metadata: { message_id: id },
    ...patch,
  };
}

function last_reply(sent: Array<{ provider: ChannelProvider; message: OutboundMessage }>): string {
  expect(sent.length).toBeGreaterThan(0);
  return String(sent[sent.length - 1]!.message.content || "");
}

/* ── Tests ─────────────────────────────────────────────── */

describe("HITL 복합 워크플로우 E2E", () => {
  let harness: HITLHarness | null = null;
  afterEach(async () => { if (harness) { await harness.cleanup(); harness = null; } });

  it("요청 → waiting_user_input → 사용자 선택 → resumed_task_id 전달 → 완료", async () => {
    let call_count = 0;

    harness = await create_hitl_harness(async (req) => {
      call_count += 1;

      if (call_count === 1) {
        // 첫 번째 호출: task 모드 결과 + waiting_user_input
        // orchestration이 task를 생성하고 선택지를 반환하는 것을 시뮬레이션
        harness!.runtime.seed_task({
          taskId: "task:telegram:chat-1:test",
          title: "ChannelTask:assistant",
          currentTurn: 3,
          maxTurns: 40,
          status: "waiting_user_input",
          currentStep: "execute",
          memory: {
            channel: "telegram",
            chat_id: "chat-1",
            objective: "추천곡 찾아서 재생",
            last_output: "다음 중 선택해주세요:\n1. Bohemian Rhapsody\n2. Hotel California\n3. Stairway to Heaven",
            __updated_at_seoul: new Date().toISOString(),
          },
        });

        return {
          reply: "다음 중 선택해주세요:\n1. Bohemian Rhapsody\n2. Hotel California\n3. Stairway to Heaven",
          mode: "task",
          tool_calls_count: 2,
          streamed: false,
        };
      }

      // 두 번째 호출: resumed_task_id가 전달되어야 함
      expect(req.resumed_task_id).toBe("task:telegram:chat-1:test");
      // resume 후 task를 completed로 전환
      harness!.runtime.update_task("task:telegram:chat-1:test", {
        status: "completed",
        exitReason: "workflow_completed",
      });

      return {
        reply: "2번 Hotel California를 재생합니다.",
        mode: "task",
        tool_calls_count: 1,
        streamed: false,
      };
    });

    // 1단계: 초기 요청
    await harness.manager.handle_inbound_message(msg("추천곡 찾아서 재생해줘"));

    expect(harness.dispatch.sent).toHaveLength(1);
    const first_reply = last_reply(harness.dispatch.sent);
    expect(first_reply).toContain("선택");
    expect(first_reply).toContain("Bohemian Rhapsody");

    // 2단계: 사용자 선택 입력 → TaskResumeService가 resume → orchestration에 resumed_task_id 전달
    await harness.manager.handle_inbound_message(msg("2번"));

    // 3개: (1) 첫 번째 응답 + (2) resume ACK "✅ 입력을 받았습니다" + (3) 두 번째 응답
    expect(harness.dispatch.sent).toHaveLength(3);
    const second_reply = last_reply(harness.dispatch.sent);
    expect(second_reply).toContain("Hotel California");
    expect(second_reply).toContain("재생");

    // orchestration이 2번 호출되었는지 확인
    expect(harness.orchestration.calls).toHaveLength(2);
    // 두 번째 호출에 resumed_task_id가 전달되었는지 확인
    expect(harness.orchestration.calls[1]!.resumed_task_id).toBe("task:telegram:chat-1:test");
  });

  it("대기 Task 없으면 TaskResumeService 통과 → 새 orchestration", async () => {
    harness = await create_hitl_harness(async () => ({
      reply: "안녕하세요!", mode: "once" as const, tool_calls_count: 0, streamed: false,
    }));

    await harness.manager.handle_inbound_message(msg("안녕"));

    expect(harness.dispatch.sent).toHaveLength(1);
    expect(last_reply(harness.dispatch.sent)).toContain("안녕");
    // resumed_task_id가 undefined
    expect(harness.orchestration.calls[0]!.resumed_task_id).toBeUndefined();
  });

  it("슬래시 명령은 TaskResumeService를 건너뛰고 CommandRouter로 라우팅", async () => {
    harness = await create_hitl_harness(async () => ({
      reply: "should not reach", mode: "once" as const, tool_calls_count: 0, streamed: false,
    }));

    // 대기 Task을 seed
    harness.runtime.seed_task({
      taskId: "task:telegram:chat-1:waiting",
      title: "Waiting Task",
      currentTurn: 2, maxTurns: 40,
      status: "waiting_user_input",
      currentStep: "execute",
      memory: { channel: "telegram", chat_id: "chat-1", __updated_at_seoul: new Date().toISOString() },
    });

    // /task 명령 → CommandRouter로 라우팅, TaskResumeService 건너뜀
    await harness.manager.handle_inbound_message(msg("/task"));

    expect(harness.dispatch.sent).toHaveLength(1);
    const reply = last_reply(harness.dispatch.sent);
    expect(reply).toContain("task:telegram:chat-1:waiting");
    expect(reply).toContain("waiting_user_input");
    // orchestration은 호출되지 않아야 함
    expect(harness.orchestration.calls).toHaveLength(0);
  });

  it("/task cancel — 대기 작업 취소", async () => {
    harness = await create_hitl_harness(async () => ({
      reply: "unreachable", mode: "once" as const, tool_calls_count: 0, streamed: false,
    }));

    harness.runtime.seed_task({
      taskId: "task-to-cancel",
      title: "Cancel Me",
      currentTurn: 1, maxTurns: 40,
      status: "waiting_user_input",
      currentStep: "execute",
      memory: { channel: "telegram", chat_id: "chat-1" },
    });

    await harness.manager.handle_inbound_message(msg("/task cancel task-to-cancel"));

    const reply = last_reply(harness.dispatch.sent);
    expect(reply).toContain("취소되었습니다");

    // 취소 후 runtime에서도 cancelled 확인
    const task = await harness.runtime.get_task("task-to-cancel");
    expect(task!.status).toBe("cancelled");
  });

  it("failed Task → TTL 이내 사용자 보강 메시지 → 재시도", async () => {
    let call_count = 0;
    harness = await create_hitl_harness(async (req) => {
      call_count += 1;
      if (call_count === 1) {
        // 재시도: resumed_task_id 확인
        expect(req.resumed_task_id).toBe("task:telegram:chat-1:failed");
        return {
          reply: "파일을 다시 분석하여 완료했습니다.",
          mode: "task" as const,
          tool_calls_count: 1,
          streamed: false,
        };
      }
      return { reply: "unexpected", mode: "once" as const, tool_calls_count: 0, streamed: false };
    });

    // failed 상태 Task seed (TTL 이내)
    harness.runtime.seed_task({
      taskId: "task:telegram:chat-1:failed",
      title: "Failed Task",
      currentTurn: 5, maxTurns: 40,
      status: "failed",
      currentStep: "execute",
      exitReason: "tool_error",
      memory: {
        channel: "telegram",
        chat_id: "chat-1",
        __updated_at_seoul: new Date().toISOString(),
      },
    });

    await harness.manager.handle_inbound_message(msg("파일을 다시 첨부합니다, 재시도해주세요"));

    // 2개: (1) resume ACK "✅ 입력을 받았습니다" + (2) 완료 응답
    expect(harness.dispatch.sent).toHaveLength(2);
    expect(last_reply(harness.dispatch.sent)).toContain("완료");
    expect(harness.orchestration.calls[0]!.resumed_task_id).toBe("task:telegram:chat-1:failed");
  });

  it("failed Task → TTL 초과 → 새 orchestration (재시도 아님)", async () => {
    harness = await create_hitl_harness(async () => ({
      reply: "새 작업 결과", mode: "once" as const, tool_calls_count: 0, streamed: false,
    }));

    // TTL 초과 (31분 전)
    const old_time = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    harness.runtime.seed_task({
      taskId: "task:telegram:chat-1:old-fail",
      title: "Old Failed Task",
      currentTurn: 3, maxTurns: 40,
      status: "failed",
      currentStep: "execute",
      memory: {
        channel: "telegram",
        chat_id: "chat-1",
        __updated_at_seoul: old_time,
      },
    });

    await harness.manager.handle_inbound_message(msg("다시 해봐"));

    expect(harness.dispatch.sent).toHaveLength(1);
    expect(last_reply(harness.dispatch.sent)).toContain("새 작업 결과");
    // resumed_task_id가 없어야 함 (새 orchestration)
    expect(harness.orchestration.calls[0]!.resumed_task_id).toBeUndefined();
  });

  it("다른 chat_id의 대기 Task에는 반응하지 않음", async () => {
    harness = await create_hitl_harness(async () => ({
      reply: "새 응답", mode: "once" as const, tool_calls_count: 0, streamed: false,
    }));

    // 다른 chat의 task
    harness.runtime.seed_task({
      taskId: "task:telegram:chat-99:waiting",
      title: "Other Chat Task",
      currentTurn: 2, maxTurns: 40,
      status: "waiting_user_input",
      currentStep: "execute",
      memory: { channel: "telegram", chat_id: "chat-99" },
    });

    await harness.manager.handle_inbound_message(msg("3번"));

    // resumed_task_id 없이 새 orchestration
    expect(harness.orchestration.calls[0]!.resumed_task_id).toBeUndefined();
  });
});
