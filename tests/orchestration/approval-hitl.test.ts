/**
 * 승인(Approval) + HITL 통합 테스트
 *
 * 검증 흐름:
 *   1. 텍스트 승인 → 도구 실행 → task resume → orchestration 재개
 *   2. Telegram 이모지 리액션 승인 → task resume
 *   3. 승인 거부 → task 재개 안 됨
 *   4. 승인 후 컨텍스트(tool_result) 보존
 *   5. 리액션 메시지가 일반 파이프라인에 진입하지 않음
 *
 * Mock 경계: OrchestrationService.execute() + AgentRuntime 승인 메서드.
 * 나머지(ApprovalService, TaskResumeService, ChannelManager)는 실제 서비스.
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
import type { TaskState } from "@src/contracts.ts";
import type {
  AgentApprovalRequest,
  AgentApprovalResolveResult,
  AgentApprovalExecuteResult,
  AgentApprovalStatus,
} from "@src/agent/runtime.types.ts";
import { MessageBus } from "@src/bus/service.ts";
import { ChannelManager } from "@src/channels/manager.ts";
import { CommandRouter } from "@src/channels/commands/router.ts";
import { ApprovalService } from "@src/channels/approval.service.ts";
import { TaskResumeService } from "@src/channels/task-resume.service.ts";
import { SessionRecorder } from "@src/channels/session-recorder.ts";
import { MediaCollector } from "@src/channels/media-collector.ts";
import {
  FakeChannelRegistry,
  FakeDispatchService,
  create_test_channel_config,
  create_noop_logger,
} from "@helpers/harness.ts";

/* ── Mock Runtime (승인 + Task 관리) ────────────────────────── */

type ApprovalDecisionAction = "approve" | "deny" | "defer" | "cancel";

class MockApprovalRuntime {
  private tasks = new Map<string, TaskState>();
  private requests = new Map<string, AgentApprovalRequest>();

  /** 테스트용: 승인 대기 도구 실행 결과. */
  execute_result: AgentApprovalExecuteResult = {
    ok: true,
    status: "approved",
    tool_name: "exec",
    result: "command output: success",
  };

  seed_task(task: TaskState): void {
    this.tasks.set(task.taskId, { ...task });
  }

  seed_approval(request: AgentApprovalRequest): void {
    this.requests.set(request.request_id, { ...request });
  }

  /* ── 승인 관련 ── */

  list_approval_requests(status?: AgentApprovalStatus): AgentApprovalRequest[] {
    const all = [...this.requests.values()];
    return status ? all.filter((r) => r.status === status) : all;
  }

  get_approval_request(request_id: string): AgentApprovalRequest | null {
    return this.requests.get(request_id) || null;
  }

  resolve_approval_request(request_id: string, response_text: string): AgentApprovalResolveResult {
    const req = this.requests.get(request_id);
    if (!req) return { ok: false, decision: "unknown", status: "pending", confidence: 0 };

    const text = response_text.toLowerCase();
    let decision: ApprovalDecisionAction = "approve";
    if (/거절|거부|deny|no|❌/.test(text)) decision = "deny";
    else if (/보류|defer|⏸/.test(text)) decision = "defer";
    else if (/취소|cancel|⛔/.test(text)) decision = "cancel";

    const status_map: Record<ApprovalDecisionAction, AgentApprovalStatus> = {
      approve: "approved",
      deny: "denied",
      defer: "deferred",
      cancel: "cancelled",
    };
    req.status = status_map[decision];
    this.requests.set(request_id, req);

    return { ok: true, decision, status: req.status, confidence: 1.0 };
  }

  async execute_approved_request(request_id: string): Promise<AgentApprovalExecuteResult> {
    const req = this.requests.get(request_id);
    if (!req || req.status !== "approved") {
      return { ok: false, status: "unknown", error: "not_approved" };
    }
    return { ...this.execute_result };
  }

  /* ── Task 관련 ── */

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

  async resume_task(task_id: string, user_input?: string, _reason?: string): Promise<TaskState | null> {
    const task = this.tasks.get(task_id);
    if (!task) return null;
    if (task.status === "completed" || task.status === "cancelled") return { ...task };
    if (user_input !== undefined) {
      task.memory.__user_input = user_input;
    }
    task.status = "running";
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
    task.exitReason = reason || "cancelled";
    this.tasks.set(task_id, task);
    return { ...task };
  }

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
}

/* ── Mock Orchestration ─────────────────────────────────────── */

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

/* ── Harness ────────────────────────────────────────────────── */

type ApprovalHarness = {
  workspace: string;
  manager: ChannelManager;
  registry: FakeChannelRegistry;
  dispatch: FakeDispatchService;
  orchestration: MockOrchestrationService;
  runtime: MockApprovalRuntime;
  cleanup: () => Promise<void>;
};

async function create_approval_harness(handler: OrchestrationHandler): Promise<ApprovalHarness> {
  const workspace = await mkdtemp(join(tmpdir(), "approval-hitl-"));
  const logger = create_noop_logger();

  const registry = new FakeChannelRegistry();
  const dispatch = new FakeDispatchService(registry);
  const orchestration = new MockOrchestrationService(handler);
  const runtime = new MockApprovalRuntime();

  const approval = new ApprovalService({
    agent_runtime: runtime as never,
    send_reply: async (_prov: ChannelProvider, message: OutboundMessage) => {
      await registry.send(message);
      return { ok: true };
    },
    resolve_reply_to: (_prov: ChannelProvider, msg: InboundMessage) => {
      return String((msg.metadata as Record<string, unknown>)?.message_id || msg.id);
    },
    logger,
  });

  const task_resume = new TaskResumeService({
    agent_runtime: runtime as never,
    logger,
  });

  const config = { ...create_test_channel_config(), autoReply: true };
  const bus = new MessageBus();

  const recorder = new SessionRecorder({
    sessions: null,
    daily_memory: null,
    sanitize_for_storage: (t: string) => t,
    logger,
  });
  const media = new MediaCollector({ workspace_dir: workspace, tokens: {} });

  const manager = new ChannelManager({
    bus,
    registry: registry as unknown as ChannelRegistryLike,
    dispatch: dispatch as unknown as DispatchService,
    command_router: new CommandRouter([]),
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

function reaction_msg(emoji: string[], patch?: Partial<InboundMessage>): InboundMessage {
  const id = `rxn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    id, provider: "telegram", channel: "telegram",
    sender_id: "user-1", chat_id: "chat-1",
    content: "", at: new Date().toISOString(),
    media: [],
    metadata: {
      message_id: id,
      is_reaction: true,
      telegram_reaction: {
        message_id: "orig-msg-1",
        emoji,
      },
    },
    ...patch,
  };
}

function last_reply_content(dispatch: FakeDispatchService): string {
  expect(dispatch.sent.length).toBeGreaterThan(0);
  return String(dispatch.sent[dispatch.sent.length - 1]!.message.content || "");
}

function all_sent_content(registry: FakeChannelRegistry): string[] {
  return registry.sent.map((m) => String(m.content || ""));
}

/* ── 공통 Task+Approval 시나리오 seed ──────────────────────── */

function seed_waiting_approval(runtime: MockApprovalRuntime, opts?: { chat_id?: string }) {
  const chat_id = opts?.chat_id || "chat-1";
  const task_id = `task:telegram:${chat_id}:approval`;

  runtime.seed_task({
    taskId: task_id,
    title: "Approval Task",
    currentTurn: 3,
    maxTurns: 40,
    status: "waiting_approval",
    currentStep: "execute",
    memory: {
      channel: "telegram",
      chat_id,
      objective: "exec 도구 실행 승인 대기",
      __updated_at_seoul: new Date().toISOString(),
    },
  });

  runtime.seed_approval({
    request_id: "req-001",
    tool_name: "exec",
    params: { command: "echo hello" },
    created_at: new Date().toISOString(),
    status: "pending",
    context: {
      channel: "telegram",
      chat_id,
      sender_id: "user-1",
      task_id,
    },
  });

  return { task_id, request_id: "req-001" };
}

/* ── Tests ──────────────────────────────────────────────────── */

describe("승인(Approval) + HITL 통합", () => {
  let harness: ApprovalHarness | null = null;
  afterEach(async () => { if (harness) { await harness.cleanup(); harness = null; } });

  it("텍스트 승인 → 도구 실행 → task resume → orchestration 재개", async () => {
    let call_count = 0;
    harness = await create_approval_harness(async (req) => {
      call_count += 1;
      if (call_count === 1) {
        // 재개된 task에서 orchestration 실행
        expect(req.resumed_task_id).toBe("task:telegram:chat-1:approval");
        harness!.runtime.update_task("task:telegram:chat-1:approval", {
          status: "completed",
          exitReason: "workflow_completed",
        });
        return {
          reply: "명령 실행 완료: echo hello → success",
          mode: "task",
          tool_calls_count: 1,
          streamed: false,
        };
      }
      return { reply: "unexpected", mode: "once", tool_calls_count: 0, streamed: false };
    });

    const { task_id } = seed_waiting_approval(harness.runtime);

    // 텍스트로 승인
    await harness.manager.handle_inbound_message(msg("승인"));

    // ApprovalService가 승인 메시지 전송 (registry.sent에 추가)
    const approval_msgs = all_sent_content(harness.registry);
    expect(approval_msgs.some((c) => c.includes("승인"))).toBe(true);

    // orchestration이 resumed_task_id와 함께 호출됨
    expect(harness.orchestration.calls).toHaveLength(1);
    expect(harness.orchestration.calls[0]!.resumed_task_id).toBe(task_id);

    // dispatch에 (1) 승인 ACK + (2) 최종 결과 전송
    expect(harness.dispatch.sent).toHaveLength(2);
    expect(last_reply_content(harness.dispatch)).toContain("실행 완료");
  });

  it("텍스트 거부 → task 재개 안 됨, 거부 메시지 전송", async () => {
    harness = await create_approval_harness(async () => ({
      reply: "should not reach", mode: "once", tool_calls_count: 0, streamed: false,
    }));

    seed_waiting_approval(harness.runtime);

    await harness.manager.handle_inbound_message(msg("거절"));

    // 거부 메시지가 전송됨
    const msgs = all_sent_content(harness.registry);
    expect(msgs.some((c) => c.includes("거부"))).toBe(true);

    // orchestration은 호출되지 않음 (task 재개 없음)
    expect(harness.orchestration.calls).toHaveLength(0);
  });

  it("승인 후 tool_result가 task memory에 주입되어 컨텍스트 보존", async () => {
    harness = await create_approval_harness(async (req) => {
      expect(req.resumed_task_id).toBe("task:telegram:chat-1:approval");
      return { reply: "완료", mode: "task", tool_calls_count: 0, streamed: false };
    });

    harness.runtime.execute_result = {
      ok: true,
      status: "approved",
      tool_name: "exec",
      result: "output: 42 files processed",
    };

    seed_waiting_approval(harness.runtime);

    await harness.manager.handle_inbound_message(msg("승인"));

    // task memory에 tool_result가 주입되었는지 확인
    const task = await harness.runtime.get_task("task:telegram:chat-1:approval");
    expect(task).not.toBeNull();
    const user_input = String(task!.memory.__user_input || "");
    expect(user_input).toContain("승인됨");
    expect(user_input).toContain("42 files processed");
  });

  it("승인 대기 요청 없으면 일반 orchestration으로 처리", async () => {
    harness = await create_approval_harness(async () => ({
      reply: "일반 응답", mode: "once", tool_calls_count: 0, streamed: false,
    }));

    // 승인 요청 없이 메시지 전송
    await harness.manager.handle_inbound_message(msg("안녕하세요"));

    expect(harness.orchestration.calls).toHaveLength(1);
    expect(harness.orchestration.calls[0]!.resumed_task_id).toBeUndefined();
    expect(last_reply_content(harness.dispatch)).toContain("일반 응답");
  });

  it("다른 chat_id의 승인 요청에는 반응하지 않음", async () => {
    harness = await create_approval_harness(async () => ({
      reply: "새 응답", mode: "once", tool_calls_count: 0, streamed: false,
    }));

    // chat-99의 승인 요청
    seed_waiting_approval(harness.runtime, { chat_id: "chat-99" });

    // chat-1에서 "승인" 전송 → chat_id 불일치로 승인 처리 안 됨
    await harness.manager.handle_inbound_message(msg("승인"));

    // 일반 orchestration 호출 (승인 처리가 아닌 새 작업)
    expect(harness.orchestration.calls).toHaveLength(1);
    expect(harness.orchestration.calls[0]!.resumed_task_id).toBeUndefined();
  });

  it("도구 실행 실패 시 에러 메시지 전송, task 재개 안 됨", async () => {
    harness = await create_approval_harness(async () => ({
      reply: "should not reach", mode: "once", tool_calls_count: 0, streamed: false,
    }));

    harness.runtime.execute_result = {
      ok: false,
      status: "unknown",
      tool_name: "exec",
      error: "permission_denied",
    };

    seed_waiting_approval(harness.runtime);

    await harness.manager.handle_inbound_message(msg("승인"));

    // 실패 메시지가 registry에 전송됨
    const msgs = all_sent_content(harness.registry);
    expect(msgs.some((c) => c.includes("실패"))).toBe(true);

    // task는 여전히 waiting_approval (재개 안 됨)
    const task = await harness.runtime.get_task("task:telegram:chat-1:approval");
    expect(task!.status).toBe("waiting_approval");

    // orchestration은 호출되지 않음
    expect(harness.orchestration.calls).toHaveLength(0);
  });

  it("승인 보류(defer) → 보류 메시지 전송, task 재개 안 됨", async () => {
    harness = await create_approval_harness(async () => ({
      reply: "should not reach", mode: "once", tool_calls_count: 0, streamed: false,
    }));

    seed_waiting_approval(harness.runtime);

    await harness.manager.handle_inbound_message(msg("보류"));

    const msgs = all_sent_content(harness.registry);
    expect(msgs.some((c) => c.includes("보류"))).toBe(true);

    // orchestration 호출 안 됨
    expect(harness.orchestration.calls).toHaveLength(0);
  });

  it("waiting_approval + waiting_user_input 동시 존재 시 승인이 우선", async () => {
    let call_count = 0;
    harness = await create_approval_harness(async (req) => {
      call_count += 1;
      if (call_count === 1) {
        expect(req.resumed_task_id).toBe("task:telegram:chat-1:approval");
        return { reply: "승인 후 완료", mode: "task", tool_calls_count: 1, streamed: false };
      }
      return { reply: "unexpected", mode: "once", tool_calls_count: 0, streamed: false };
    });

    // waiting_approval task
    seed_waiting_approval(harness.runtime);

    // waiting_user_input task (다른 task)
    harness.runtime.seed_task({
      taskId: "task:telegram:chat-1:waiting",
      title: "User Input Task",
      currentTurn: 2, maxTurns: 40,
      status: "waiting_user_input",
      currentStep: "execute",
      memory: { channel: "telegram", chat_id: "chat-1", __updated_at_seoul: new Date().toISOString() },
    });

    // "승인"은 ApprovalService가 먼저 처리 (파이프라인 우선순위)
    await harness.manager.handle_inbound_message(msg("승인"));

    // approval task가 재개됨
    expect(harness.orchestration.calls).toHaveLength(1);
    expect(harness.orchestration.calls[0]!.resumed_task_id).toBe("task:telegram:chat-1:approval");
  });
});

describe("Telegram 리액션 기반 승인", () => {
  let harness: ApprovalHarness | null = null;
  afterEach(async () => { if (harness) { await harness.cleanup(); harness = null; } });

  it("👍 리액션 → 승인 처리 (try_handle_approval_reactions)", async () => {
    harness = await create_approval_harness(async () => ({
      reply: "ok", mode: "once", tool_calls_count: 0, streamed: false,
    }));

    const { request_id } = seed_waiting_approval(harness.runtime);

    const rxn = reaction_msg(["👍"]);

    // ApprovalService.try_handle_approval_reactions 직접 호출
    // (poll loop 시뮬레이션은 복잡하므로 서비스 수준에서 검증)
    const approval_service = new ApprovalService({
      agent_runtime: harness.runtime as never,
      send_reply: async (_prov, message) => {
        await harness!.registry.send(message);
        return { ok: true };
      },
      resolve_reply_to: (_prov, m) => String((m.metadata as Record<string, unknown>)?.message_id || m.id),
      logger: create_noop_logger(),
    });

    const result = await approval_service.try_handle_approval_reactions("telegram", [rxn]);

    expect(result.handled).toBe(true);
    expect(result.task_id).toBe("task:telegram:chat-1:approval");
    expect(result.tool_result).toBeDefined();
    expect(result.tool_result).toContain("success");

    // 승인 요청 상태가 approved로 변경됨
    const req = harness.runtime.get_approval_request(request_id);
    expect(req!.status).toBe("approved");
  });

  it("👎 리액션 → 거부 처리", async () => {
    harness = await create_approval_harness(async () => ({
      reply: "ok", mode: "once", tool_calls_count: 0, streamed: false,
    }));

    const { request_id } = seed_waiting_approval(harness.runtime);

    const approval_service = new ApprovalService({
      agent_runtime: harness.runtime as never,
      send_reply: async (_prov, message) => {
        await harness!.registry.send(message);
        return { ok: true };
      },
      resolve_reply_to: (_prov, m) => String((m.metadata as Record<string, unknown>)?.message_id || m.id),
      logger: create_noop_logger(),
    });

    const result = await approval_service.try_handle_approval_reactions("telegram", [reaction_msg(["👎"])]);

    expect(result.handled).toBe(true);
    // 거부 시 tool_result가 없어야 함 (실행하지 않음)
    expect(result.tool_result).toBeUndefined();

    const req = harness.runtime.get_approval_request(request_id);
    expect(req!.status).toBe("denied");
  });

  it("리액션 메시지가 is_reaction 플래그를 가짐", () => {
    const rxn = reaction_msg(["✅"]);
    const meta = (rxn.metadata || {}) as Record<string, unknown>;
    expect(meta.is_reaction).toBe(true);

    const normal = msg("일반 메시지");
    const normal_meta = (normal.metadata || {}) as Record<string, unknown>;
    expect(normal_meta.is_reaction).toBeUndefined();
  });

  it("승인 대기 요청 없는 리액션 → handled:false", async () => {
    harness = await create_approval_harness(async () => ({
      reply: "ok", mode: "once", tool_calls_count: 0, streamed: false,
    }));

    // 승인 요청 없이 리액션만 발생
    const approval_service = new ApprovalService({
      agent_runtime: harness.runtime as never,
      send_reply: async (_prov, message) => {
        await harness!.registry.send(message);
        return { ok: true };
      },
      resolve_reply_to: (_prov, m) => String((m.metadata as Record<string, unknown>)?.message_id || m.id),
      logger: create_noop_logger(),
    });

    const result = await approval_service.try_handle_approval_reactions("telegram", [reaction_msg(["👍"])]);

    expect(result.handled).toBe(false);
    expect(result.task_id).toBeUndefined();
  });

  it("resume_after_approval → waiting_approval task가 running으로 전환", async () => {
    harness = await create_approval_harness(async () => ({
      reply: "ok", mode: "once", tool_calls_count: 0, streamed: false,
    }));

    const { task_id } = seed_waiting_approval(harness.runtime);

    const task_resume = new TaskResumeService({
      agent_runtime: harness.runtime as never,
      logger: create_noop_logger(),
    });

    const ok = await task_resume.resume_after_approval(task_id, "exec output: hello world");

    expect(ok).toBe(true);

    // task가 running 상태로 전환됨
    const task = await harness.runtime.get_task(task_id);
    expect(task!.status).toBe("running");

    // tool_result가 memory에 주입됨
    const input = String(task!.memory.__user_input || "");
    expect(input).toContain("승인됨");
    expect(input).toContain("hello world");
  });

  it("resume_after_approval — 이미 completed된 task → false 반환", async () => {
    harness = await create_approval_harness(async () => ({
      reply: "ok", mode: "once", tool_calls_count: 0, streamed: false,
    }));

    harness.runtime.seed_task({
      taskId: "task:done",
      title: "Done",
      currentTurn: 5, maxTurns: 40,
      status: "completed",
      currentStep: "finalize",
      memory: { channel: "telegram", chat_id: "chat-1" },
    });

    const task_resume = new TaskResumeService({
      agent_runtime: harness.runtime as never,
      logger: create_noop_logger(),
    });

    const ok = await task_resume.resume_after_approval("task:done", "some result");

    // completed task은 resume 불가
    expect(ok).toBe(false);
  });
});

describe("승인 + HITL 복합 시나리오", () => {
  let harness: ApprovalHarness | null = null;
  afterEach(async () => { if (harness) { await harness.cleanup(); harness = null; } });

  it("초기 요청 → waiting_user_input → 사용자 선택 → waiting_approval → 승인 → 완료", async () => {
    let call_count = 0;
    harness = await create_approval_harness(async (req) => {
      call_count += 1;

      if (call_count === 1) {
        // 1단계: 추천 결과 + waiting_user_input
        harness!.runtime.seed_task({
          taskId: "task:telegram:chat-1:compound",
          title: "Compound Task",
          currentTurn: 2, maxTurns: 40,
          status: "waiting_user_input",
          currentStep: "execute",
          memory: {
            channel: "telegram",
            chat_id: "chat-1",
            objective: "곡 추천 후 재생",
            __updated_at_seoul: new Date().toISOString(),
          },
        });
        return {
          reply: "추천 결과:\n1. Song A\n2. Song B\n3. Song C\n선택해주세요.",
          mode: "task",
          tool_calls_count: 1,
          streamed: false,
        };
      }

      if (call_count === 2) {
        // 2단계: 사용자 선택 후 → waiting_approval (도구 승인 필요)
        expect(req.resumed_task_id).toBe("task:telegram:chat-1:compound");

        // 도구 승인 대기 상태로 전환
        harness!.runtime.update_task("task:telegram:chat-1:compound", {
          status: "waiting_approval",
        });
        harness!.runtime.seed_approval({
          request_id: "req-compound",
          tool_name: "exec",
          params: { command: "play Song B" },
          created_at: new Date().toISOString(),
          status: "pending",
          context: {
            channel: "telegram",
            chat_id: "chat-1",
            task_id: "task:telegram:chat-1:compound",
          },
        });

        return {
          reply: "Song B를 재생하려면 승인이 필요합니다.",
          mode: "task",
          tool_calls_count: 0,
          streamed: false,
        };
      }

      if (call_count === 3) {
        // 3단계: 승인 후 재개 → 최종 완료
        expect(req.resumed_task_id).toBe("task:telegram:chat-1:compound");
        harness!.runtime.update_task("task:telegram:chat-1:compound", {
          status: "completed",
          exitReason: "workflow_completed",
        });
        return {
          reply: "Song B 재생을 시작합니다.",
          mode: "task",
          tool_calls_count: 1,
          streamed: false,
        };
      }

      return { reply: "unexpected", mode: "once", tool_calls_count: 0, streamed: false };
    });

    // 1단계: 초기 요청
    await harness.manager.handle_inbound_message(msg("추천곡 찾아서 재생해줘"));
    expect(harness.dispatch.sent).toHaveLength(1);
    expect(last_reply_content(harness.dispatch)).toContain("Song A");

    // 2단계: 사용자 선택 → (2) resume ACK + (3) 승인 요청 응답
    await harness.manager.handle_inbound_message(msg("2번"));
    expect(harness.dispatch.sent).toHaveLength(3);
    expect(last_reply_content(harness.dispatch)).toContain("승인이 필요");

    // 3단계: 승인 → (4) 승인 ACK + (5) 최종 응답
    await harness.manager.handle_inbound_message(msg("승인"));
    expect(harness.dispatch.sent).toHaveLength(5);
    expect(last_reply_content(harness.dispatch)).toContain("재생을 시작");

    // 총 3번의 orchestration 호출
    expect(harness.orchestration.calls).toHaveLength(3);
    // 2, 3번째에 resumed_task_id가 전달됨
    expect(harness.orchestration.calls[1]!.resumed_task_id).toBe("task:telegram:chat-1:compound");
    expect(harness.orchestration.calls[2]!.resumed_task_id).toBe("task:telegram:chat-1:compound");
  });

  it("task 실패 후 재시도 → 승인 → 완료 (multi-step recovery)", async () => {
    let call_count = 0;
    harness = await create_approval_harness(async (req) => {
      call_count += 1;

      if (call_count === 1) {
        // 재시도: failed task에서 사용자 보강 메시지로 재개
        expect(req.resumed_task_id).toBe("task:telegram:chat-1:retry");

        // 재시도 후 승인 필요 상태
        harness!.runtime.update_task("task:telegram:chat-1:retry", {
          status: "waiting_approval",
        });
        harness!.runtime.seed_approval({
          request_id: "req-retry",
          tool_name: "exec",
          params: { command: "deploy v2" },
          created_at: new Date().toISOString(),
          status: "pending",
          context: {
            channel: "telegram",
            chat_id: "chat-1",
            task_id: "task:telegram:chat-1:retry",
          },
        });

        return {
          reply: "배포를 재시도합니다. 승인이 필요합니다.",
          mode: "task",
          tool_calls_count: 0,
          streamed: false,
        };
      }

      if (call_count === 2) {
        // 승인 후 최종 실행
        expect(req.resumed_task_id).toBe("task:telegram:chat-1:retry");
        harness!.runtime.update_task("task:telegram:chat-1:retry", {
          status: "completed",
        });
        return {
          reply: "배포 완료!",
          mode: "task",
          tool_calls_count: 1,
          streamed: false,
        };
      }

      return { reply: "unexpected", mode: "once", tool_calls_count: 0, streamed: false };
    });

    // failed task seed
    harness.runtime.seed_task({
      taskId: "task:telegram:chat-1:retry",
      title: "Deploy Task",
      currentTurn: 4, maxTurns: 40,
      status: "failed",
      currentStep: "execute",
      exitReason: "network_error",
      memory: {
        channel: "telegram",
        chat_id: "chat-1",
        __updated_at_seoul: new Date().toISOString(),
      },
    });

    // 1단계: 사용자 보강 메시지로 재시도 → (1) resume ACK + (2) 승인 요청 응답
    await harness.manager.handle_inbound_message(msg("네트워크 복구됨, 다시 시도해줘"));
    expect(harness.dispatch.sent).toHaveLength(2);
    expect(last_reply_content(harness.dispatch)).toContain("승인이 필요");

    // 2단계: 승인 → (3) 승인 ACK + (4) 최종 응답
    await harness.manager.handle_inbound_message(msg("승인"));
    expect(harness.dispatch.sent).toHaveLength(4);
    expect(last_reply_content(harness.dispatch)).toContain("배포 완료");
  });
});
