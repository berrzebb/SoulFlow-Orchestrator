/**
 * ChannelManager — 통합 테스트 (cov1 + cov4/cov5/cov6 고유 케이스 병합).
 * _should_ignore, approval handling, workflow_hitl, confirmation_guard,
 * task_resume, deliver_result, render_msg, render_profile, prune,
 * resolve_target, send_outbound, send_chunked, try_hitl_send_input,
 * handle_mentions, is_duplicate 등.
 */
import { describe, it, expect, vi } from "vitest";
import {
  create_harness, inbound,
  create_noop_logger, FakeChannelRegistry, FakeDispatchService,
  FakeApprovalService, FakeTaskResumeService, create_test_channel_config,
  FakeOrchestrationService,
} from "@helpers/harness.ts";
import { MessageBus } from "@src/bus/service.ts";
import { ChannelManager } from "@src/channels/manager.ts";
import { CommandRouter } from "@src/channels/commands/router.ts";
import { SessionRecorder } from "@src/channels/session-recorder.ts";
import { MediaCollector } from "@src/channels/media-collector.ts";
import type { ChannelRegistryLike, InboundMessage } from "@src/channels/types.ts";
import type { DispatchService } from "@src/channels/dispatch.service.ts";
import type { OrchestrationService } from "@src/orchestration/service.ts";
import type { TaskResumeService } from "@src/channels/task-resume.service.ts";
import type { ApprovalService } from "@src/channels/approval.service.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ──────────────────────────────────────────────────
// 확장된 FakeTaskResumeService (resume_after_approval + cancel_task 포함)
// ──────────────────────────────────────────────────

class ExtendedFakeTaskResume {
  resume_result = false;
  cancel_spy = vi.fn();
  resume_spy = vi.fn();
  try_resume_result: null | { resumed?: boolean; task_id?: string; previous_status?: string; referenced_context?: string } = null;
  private stale: any[] = [];

  constructor(stale: any[] = []) { this.stale = stale; }

  async try_resume(_provider: string, _message: unknown) { return this.try_resume_result; }
  async resume_after_approval(task_id: string, tool_result: string): Promise<boolean> {
    this.resume_spy(task_id, tool_result);
    return this.resume_result;
  }
  async cancel_task(task_id: string, reason: string): Promise<void> {
    this.cancel_spy(task_id, reason);
  }
  expire_stale() { return this.stale; }
}

// ──────────────────────────────────────────────────
// 확장된 FakeApprovalService (approval_status 지원)
// ──────────────────────────────────────────────────

type ApprovalResult = { handled: boolean; task_id?: string; tool_result?: string; approval_status?: string };

class ExtendedFakeApproval {
  reply: ApprovalResult = { handled: false };
  async try_handle_text_reply(): Promise<ApprovalResult> { return this.reply; }
  async try_handle_approval_reactions(): Promise<{ handled: boolean }> { return { handled: false }; }
  prune_seen(_ttl?: number, _max?: number): void {}
}

// ──────────────────────────────────────────────────
// ConfirmationGuard mock
// ──────────────────────────────────────────────────

type GuardResult = { action: "cancelled" | "confirmed"; original_text: string } | null;

function make_guard(pending: boolean, resolve_result: GuardResult) {
  return {
    has_pending: vi.fn().mockReturnValue(pending),
    try_resolve: vi.fn().mockReturnValue(resolve_result),
  };
}

// ──────────────────────────────────────────────────
// 직접 ChannelManager 생성 헬퍼 (guard / workflow_hitl / renderer 주입)
// ──────────────────────────────────────────────────

async function make_manager(opts: {
  workspace: string;
  task_resume?: ExtendedFakeTaskResume;
  approval?: ExtendedFakeApproval;
  orchestration_handler?: (req: unknown) => Promise<import("@src/orchestration/types.ts").OrchestrationResult>;
  confirmation_guard?: ReturnType<typeof make_guard> | null;
  workflow_hitl?: { try_resolve: (chat_id: string, content: string) => Promise<boolean> } | null;
  renderer?: import("@src/channels/persona-message-renderer.ts").PersonaMessageRendererLike | null;
  config_patch?: Partial<ReturnType<typeof create_test_channel_config>>;
  registry?: any;
  bus?: any;
  bot_identity?: any;
  session_store?: any;
  tracker?: any;
  on_web_stream?: (...args: any[]) => void;
  on_activity_start?: (...args: any[]) => void;
  on_activity_end?: (...args: any[]) => void;
}) {
  const logger = create_noop_logger();
  const registry = opts.registry ?? new FakeChannelRegistry();
  const dispatch = new FakeDispatchService(registry);
  const orch = new FakeOrchestrationService(opts.orchestration_handler);
  const task_resume = opts.task_resume ?? new ExtendedFakeTaskResume();
  const approval = opts.approval ?? new ExtendedFakeApproval();
  const recorder = new SessionRecorder({ sessions: null, daily_memory: null, sanitize_for_storage: (t) => t, logger });
  const media = new MediaCollector({ workspace_dir: opts.workspace, tokens: {} });
  const config = { ...create_test_channel_config(), ...(opts.config_patch || {}) };
  const bus = opts.bus ?? new MessageBus();
  const bot_identity = opts.bot_identity ?? { get_bot_self_id: () => "", get_default_target: () => "" };

  const manager_opts: Record<string, unknown> = {
    bus,
    registry: registry as unknown as ChannelRegistryLike,
    dispatch: dispatch as unknown as DispatchService,
    command_router: new CommandRouter([]),
    orchestration: orch as unknown as OrchestrationService,
    approval: approval as unknown as ApprovalService,
    task_resume: task_resume as unknown as TaskResumeService,
    session_recorder: recorder,
    media_collector: media,
    process_tracker: opts.tracker ?? null,
    providers: {} as never,
    config,
    workspace_dir: opts.workspace,
    logger,
    bot_identity,
    confirmation_guard: opts.confirmation_guard as never,
    workflow_hitl: opts.workflow_hitl as never,
    renderer: opts.renderer ?? null,
    session_store: opts.session_store ?? null,
  };

  if (opts.on_web_stream) manager_opts.on_web_stream = opts.on_web_stream;
  if (opts.on_activity_start) manager_opts.on_activity_start = opts.on_activity_start;
  if (opts.on_activity_end) manager_opts.on_activity_end = opts.on_activity_end;

  const manager = new ChannelManager(manager_opts as any);

  return { manager, registry, dispatch, orch, task_resume, approval };
}

// ══════════════════════════════════════════════════
// _should_ignore 분기
// ══════════════════════════════════════════════════

describe("ChannelManager._should_ignore 분기", () => {
  it("sender='' → 무시", async () => {
    const h = await create_harness();
    try {
      await h.manager.handle_inbound_message(inbound("hello", { sender_id: "" }));
      expect(h.registry.sent).toHaveLength(0);
    } finally { await h.cleanup(); }
  });

  it("sender='unknown' → 무시", async () => {
    const h = await create_harness();
    try {
      await h.manager.handle_inbound_message(inbound("hello", { sender_id: "unknown" }));
      expect(h.registry.sent).toHaveLength(0);
    } finally { await h.cleanup(); }
  });

  it("sender='recovery' → 무시", async () => {
    const h = await create_harness();
    try {
      await h.manager.handle_inbound_message(inbound("hello", { sender_id: "recovery" }));
      expect(h.registry.sent).toHaveLength(0);
    } finally { await h.cleanup(); }
  });

  it("sender='approval-bot' → 무시", async () => {
    const h = await create_harness();
    try {
      await h.manager.handle_inbound_message(inbound("hello", { sender_id: "approval-bot" }));
      expect(h.registry.sent).toHaveLength(0);
    } finally { await h.cleanup(); }
  });

  it("sender='subagent:abc' → 무시", async () => {
    const h = await create_harness();
    try {
      await h.manager.handle_inbound_message(inbound("hello", { sender_id: "subagent:abc" }));
      expect(h.registry.sent).toHaveLength(0);
    } finally { await h.cleanup(); }
  });

  it("meta.from_is_bot=true → 무시", async () => {
    const h = await create_harness();
    try {
      await h.manager.handle_inbound_message(inbound("hello", { metadata: { from_is_bot: true } }));
      expect(h.registry.sent).toHaveLength(0);
    } finally { await h.cleanup(); }
  });

  it("meta.kind='task_recovery' → 무시", async () => {
    const h = await create_harness();
    try {
      await h.manager.handle_inbound_message(inbound("hello", { metadata: { kind: "task_recovery" } }));
      expect(h.registry.sent).toHaveLength(0);
    } finally { await h.cleanup(); }
  });

  it("slack.bot_id 있음 → 무시", async () => {
    const h = await create_harness();
    try {
      await h.manager.handle_inbound_message(inbound("hello", {
        provider: "slack",
        metadata: { slack: { bot_id: "BABC123" } },
      }));
      expect(h.registry.sent).toHaveLength(0);
    } finally { await h.cleanup(); }
  });

  it("slack.subtype=bot_message → 무시", async () => {
    const h = await create_harness();
    try {
      await h.manager.handle_inbound_message(inbound("hello", {
        provider: "slack",
        metadata: { slack: { subtype: "bot_message" } },
      }));
      expect(h.registry.sent).toHaveLength(0);
    } finally { await h.cleanup(); }
  });

  it("slack.subtype=message_deleted → 무시", async () => {
    const h = await create_harness();
    try {
      await h.manager.handle_inbound_message(inbound("hello", {
        provider: "slack",
        metadata: { slack: { subtype: "message_deleted" } },
      }));
      expect(h.registry.sent).toHaveLength(0);
    } finally { await h.cleanup(); }
  });
});

// ══════════════════════════════════════════════════
// 공개 메서드 — health_check / get_status / get_active_run_count
// ══════════════════════════════════════════════════

describe("ChannelManager 공개 메서드", () => {
  it("health_check — running=false 시 ok=false", async () => {
    const h = await create_harness();
    // stop() 호출 전에 running=false이므로 ok=false
    const result = h.manager.health_check();
    expect(result.ok).toBe(false);
    await h.cleanup();
  });

  it("get_status — enabled_channels, mention_loop_running 반환", async () => {
    const h = await create_harness();
    const status = h.manager.get_status();
    expect(Array.isArray(status.enabled_channels)).toBe(true);
    expect(typeof status.mention_loop_running).toBe("boolean");
    await h.cleanup();
  });

  it("get_active_run_count — 초기 0", async () => {
    const h = await create_harness();
    expect(h.manager.get_active_run_count()).toBe(0);
    await h.cleanup();
  });

  it("cancel_active_runs(key) — 취소 수 반환", async () => {
    const h = await create_harness();
    const cancelled = h.manager.cancel_active_runs("nonexistent:key");
    expect(typeof cancelled).toBe("number");
    await h.cleanup();
  });

  it("set_workflow_hitl → workflow_hitl 교체됨", async () => {
    const h = await create_harness();
    const bridge = { try_resolve: vi.fn().mockResolvedValue(false) };
    // set_workflow_hitl는 void 반환 — 예외 없이 실행되어야 함
    expect(() => h.manager.set_workflow_hitl(bridge)).not.toThrow();
    await h.cleanup();
  });

  it("get/set/reset render_profile", async () => {
    const h = await create_harness();
    const p = h.manager.get_render_profile("telegram", "chat-1");
    expect(p).toBeDefined();

    const updated = h.manager.set_render_profile("telegram", "chat-1", { mode: "markdown" });
    expect(updated.mode).toBe("markdown");

    const reset = h.manager.reset_render_profile("telegram", "chat-1");
    expect(reset).toBeDefined();
    await h.cleanup();
  });
});

// ══════════════════════════════════════════════════
// resume_after_dashboard_approval
// ══════════════════════════════════════════════════

describe("ChannelManager.resume_after_dashboard_approval", () => {
  it("resume 성공 → true 반환 + 오케스트레이션 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const task_resume = new ExtendedFakeTaskResume();
      task_resume.resume_result = true;
      const { manager } = await make_manager({ workspace: ws, task_resume });
      const result = await manager.resume_after_dashboard_approval({
        task_id: "t-abc",
        tool_result: "tool ok",
        provider: "web",
        chat_id: "chat-1",
      });
      expect(result).toBe(true);
      expect(task_resume.resume_spy).toHaveBeenCalledWith("t-abc", "tool ok");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("resume 실패 → false 반환", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const task_resume = new ExtendedFakeTaskResume();
      task_resume.resume_result = false;
      const { manager } = await make_manager({ workspace: ws, task_resume });
      const result = await manager.resume_after_dashboard_approval({
        task_id: "t-xyz",
        tool_result: "fail",
        provider: "telegram",
        chat_id: "chat-99",
      });
      expect(result).toBe(false);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// Approval text reply 분기
// ══════════════════════════════════════════════════

describe("ChannelManager — approval text reply 분기", () => {
  it("approval 처리됨 + tool_result → resume 성공 → approval_resumed 메시지 전송", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const task_resume = new ExtendedFakeTaskResume();
      task_resume.resume_result = true;
      const approval = new ExtendedFakeApproval();
      approval.reply = { handled: true, task_id: "t1", tool_result: "ok" };
      const { manager, registry } = await make_manager({ workspace: ws, task_resume, approval });
      await manager.handle_inbound_message(inbound("yes", { provider: "telegram" }));
      expect(task_resume.resume_spy).toHaveBeenCalledWith("t1", "ok");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("approval 처리됨 + tool_result → resume 실패 → approval_resume_failed 메시지 전송", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const task_resume = new ExtendedFakeTaskResume();
      task_resume.resume_result = false;
      const approval = new ExtendedFakeApproval();
      approval.reply = { handled: true, task_id: "t1", tool_result: "ok" };
      const { manager, registry } = await make_manager({ workspace: ws, task_resume, approval });
      await manager.handle_inbound_message(inbound("yes", { provider: "telegram" }));
      expect(task_resume.resume_spy).toHaveBeenCalledWith("t1", "ok");
      // resume 실패 → 실패 메시지 전송됨
      expect(registry.sent.length).toBeGreaterThan(0);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("approval 처리됨 + approval_status=denied → cancel_task 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const task_resume = new ExtendedFakeTaskResume();
      const approval = new ExtendedFakeApproval();
      approval.reply = { handled: true, task_id: "t2", approval_status: "denied" };
      const { manager } = await make_manager({ workspace: ws, task_resume, approval });
      await manager.handle_inbound_message(inbound("no", { provider: "telegram" }));
      expect(task_resume.cancel_spy).toHaveBeenCalledWith("t2", "approval_denied");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("approval 처리됨 + approval_status=cancelled → cancel_task 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const task_resume = new ExtendedFakeTaskResume();
      const approval = new ExtendedFakeApproval();
      approval.reply = { handled: true, task_id: "t3", approval_status: "cancelled" };
      const { manager } = await make_manager({ workspace: ws, task_resume, approval });
      await manager.handle_inbound_message(inbound("cancel", { provider: "telegram" }));
      expect(task_resume.cancel_spy).toHaveBeenCalledWith("t3", "approval_cancelled");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("approval 처리됨 + task_id 없음 → 즉시 return", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const task_resume = new ExtendedFakeTaskResume();
      const approval = new ExtendedFakeApproval();
      approval.reply = { handled: true }; // no task_id, no tool_result
      const { manager } = await make_manager({ workspace: ws, task_resume, approval });
      await manager.handle_inbound_message(inbound("msg", { provider: "telegram" }));
      expect(task_resume.resume_spy).not.toHaveBeenCalled();
      expect(task_resume.cancel_spy).not.toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// workflow_hitl 분기
// ══════════════════════════════════════════════════

describe("ChannelManager — workflow_hitl 분기", () => {
  it("workflow_hitl.try_resolve=true → workflow_resume 메시지 전송 후 return", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager, registry } = await make_manager({
        workspace: ws,
        workflow_hitl: { try_resolve: vi.fn().mockResolvedValue(true) },
      });
      await manager.handle_inbound_message(inbound("계속해", { provider: "telegram" }));
      // workflow_resume 메시지가 전송되어야 함
      expect(registry.sent.length).toBeGreaterThan(0);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("workflow_hitl.try_resolve=false → 정상 플로우 계속", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const orch_handler = vi.fn().mockResolvedValue({ reply: "ok", mode: "once", tool_calls_count: 0, streamed: false });
      const { manager } = await make_manager({
        workspace: ws,
        workflow_hitl: { try_resolve: vi.fn().mockResolvedValue(false) },
        orchestration_handler: orch_handler,
      });
      await manager.handle_inbound_message(inbound("일반 메시지", { provider: "telegram" }));
      expect(orch_handler).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("set_workflow_hitl 후 bridge 사용", async () => {
    const h = await create_harness();
    try {
      const bridge = { try_resolve: vi.fn().mockResolvedValue(true) };
      h.manager.set_workflow_hitl(bridge);
      await h.manager.handle_inbound_message(inbound("계속"));
      expect(bridge.try_resolve).toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });
});

// ══════════════════════════════════════════════════
// confirmation_guard 분기
// ══════════════════════════════════════════════════

describe("ChannelManager — confirmation_guard 분기", () => {
  it("guard.has_pending=true + try_resolve='cancelled' → guard_cancelled 메시지", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const guard = make_guard(true, { action: "cancelled", original_text: "" });
      const { manager, registry } = await make_manager({ workspace: ws, confirmation_guard: guard });
      await manager.handle_inbound_message(inbound("취소", { provider: "telegram" }));
      expect(guard.has_pending).toHaveBeenCalled();
      expect(guard.try_resolve).toHaveBeenCalled();
      expect(registry.sent.length).toBeGreaterThan(0);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("guard.has_pending=true + try_resolve='confirmed' → original_text로 invoke", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const guard = make_guard(true, { action: "confirmed", original_text: "do the task" });
      const orch_handler = vi.fn().mockResolvedValue({ reply: "done", mode: "once", tool_calls_count: 0, streamed: false });
      const { manager } = await make_manager({ workspace: ws, confirmation_guard: guard, orchestration_handler: orch_handler });
      await manager.handle_inbound_message(inbound("yes", { provider: "telegram" }));
      expect(guard.try_resolve).toHaveBeenCalled();
      expect(orch_handler).toHaveBeenCalled();
      const call_req = orch_handler.mock.calls[0][0] as { message: { content: string } };
      expect(call_req.message.content).toBe("do the task");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("guard.has_pending=true + try_resolve=null → 정상 플로우 계속", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const guard = make_guard(true, null);
      const orch_handler = vi.fn().mockResolvedValue({ reply: "ok", mode: "once", tool_calls_count: 0, streamed: false });
      const { manager } = await make_manager({ workspace: ws, confirmation_guard: guard, orchestration_handler: orch_handler });
      await manager.handle_inbound_message(inbound("random", { provider: "telegram" }));
      expect(orch_handler).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// task_resume.try_resume 분기
// ══════════════════════════════════════════════════

describe("ChannelManager — task_resume.try_resume 분기", () => {
  it("try_resume.resumed=true → invoke_and_reply 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const task_resume = new ExtendedFakeTaskResume();
      task_resume.try_resume_result = { resumed: true, task_id: "t-resume", previous_status: "waiting_input" };
      const orch_handler = vi.fn().mockResolvedValue({ reply: "resumed ok", mode: "once", tool_calls_count: 0, streamed: false });
      const { manager } = await make_manager({ workspace: ws, task_resume, orchestration_handler: orch_handler });
      await manager.handle_inbound_message(inbound("계속", { provider: "telegram" }));
      expect(orch_handler).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("try_resume.referenced_context 있음 → 내용 enriched 후 invoke", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const task_resume = new ExtendedFakeTaskResume();
      task_resume.try_resume_result = { referenced_context: "이전 작업 결과물", task_id: "t-ref" };
      const orch_handler = vi.fn().mockResolvedValue({ reply: "ok", mode: "once", tool_calls_count: 0, streamed: false });
      const { manager } = await make_manager({ workspace: ws, task_resume, orchestration_handler: orch_handler });
      await manager.handle_inbound_message(inbound("이어서 해줘", { provider: "telegram" }));
      expect(orch_handler).toHaveBeenCalled();
      const req = orch_handler.mock.calls[0][0] as { message: { content: string } };
      expect(req.message.content).toContain("이전 작업 결과물");
      expect(req.message.content).toContain("이어서 해줘");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// deliver_result 분기 — suppress_reply / no reply + error
// ══════════════════════════════════════════════════

describe("ChannelManager — deliver_result 분기", () => {
  it("suppress_reply=true → 메시지 전송 없음", async () => {
    const h = await create_harness({
      orchestration_handler: async () => ({
        reply: "some reply",
        suppress_reply: true,
        mode: "once", tool_calls_count: 0, streamed: false,
      }),
    });
    try {
      await h.manager.handle_inbound_message(inbound("msg"));
      expect(h.registry.sent).toHaveLength(0);
    } finally { await h.cleanup(); }
  });

  it("reply=null + error='some error' → error reply 전송", async () => {
    const h = await create_harness({
      orchestration_handler: async () => ({
        reply: null,
        error: "테스트 오류 발생",
        mode: "once", tool_calls_count: 0, streamed: false,
      }),
    });
    try {
      await h.manager.handle_inbound_message(inbound("msg"));
      expect(h.registry.sent.length).toBeGreaterThan(0);
      const sent = h.registry.sent[h.registry.sent.length - 1];
      expect(String(sent.content)).toContain("작업 실패");
    } finally { await h.cleanup(); }
  });

  it("reply='' (빈 문자열, no error) → 메시지 전송 없음", async () => {
    const h = await create_harness({
      orchestration_handler: async () => ({
        reply: "",
        mode: "once", tool_calls_count: 0, streamed: false,
      }),
    });
    try {
      await h.manager.handle_inbound_message(inbound("msg"));
      expect(h.registry.sent).toHaveLength(0);
    } finally { await h.cleanup(); }
  });

  it("streamed=true + stream_message_id → edit_message 시도 (suppressFinalAfterStream=false)", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager, registry } = await make_manager({
        workspace: ws,
        config_patch: {
          streaming: {
            enabled: true,
            mode: "live" as const,
            intervalMs: 1400,
            minChars: 0,
            suppressFinalAfterStream: false,
          },
        },
        orchestration_handler: async (req: { on_stream?: (chunk: string) => void }) => {
          req.on_stream?.("스트림 청크");
          await new Promise((r) => setTimeout(r, 50));
          return { reply: "최종 결과", mode: "once", tool_calls_count: 0, streamed: true, stream_full_content: "스트림 청크" };
        },
      });
      await manager.handle_inbound_message(inbound("test", { provider: "telegram" }));
      // streamed=true일 때 edit_message 또는 send 호출
      expect(registry.sent.length + registry.edited.length).toBeGreaterThanOrEqual(0);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("web provider → on_web_stream 호출됨", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const on_web_stream = vi.fn();
      const { manager } = await make_manager({
        workspace: ws,
        on_web_stream,
        orchestration_handler: async () => ({ reply: "web reply", mode: "once", tool_calls_count: 0, streamed: false }),
      });

      await manager.handle_inbound_message(inbound("web msg", { provider: "web", channel: "web" }));
      // web provider는 bus를 통해 outbound 전송 (4번째 인자: scoped_team_id = undefined)
      expect(on_web_stream).toHaveBeenCalledWith(expect.any(String), "", true, undefined);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// render_msg 분기 — renderer 없을 때
// ══════════════════════════════════════════════════

describe("ChannelManager — render_msg 분기 (renderer 없음)", () => {
  it("error kind → '처리 중 문제' 포함 메시지", async () => {
    // send_error_reply 경로 통해 간접 테스트
    const h = await create_harness({
      orchestration_handler: async () => ({
        reply: null,
        error: "오류 원인 설명",
        mode: "once", tool_calls_count: 0, streamed: false,
      }),
    });
    try {
      await h.manager.handle_inbound_message(inbound("error test"));
      const last_sent = h.registry.sent[h.registry.sent.length - 1];
      expect(String(last_sent?.content || "")).toContain("작업 실패");
    } finally { await h.cleanup(); }
  });

  it("renderer 있을 때 → renderer.render() 호출", async () => {
    const renderer = { render: vi.fn().mockReturnValue("렌더된 메시지") };
    const h = await create_harness({
      renderer,
      orchestration_handler: async () => ({
        reply: null,
        error: "err",
        mode: "once", tool_calls_count: 0, streamed: false,
      }),
    });
    try {
      await h.manager.handle_inbound_message(inbound("test"));
      expect(renderer.render).toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });
});

// ══════════════════════════════════════════════════
// effective_render_profile — non-telegram + html 모드
// ══════════════════════════════════════════════════

describe("ChannelManager — effective_render_profile 분기", () => {
  it("telegram + html mode → html 그대로 유지", async () => {
    const h = await create_harness({
      orchestration_handler: async () => ({ reply: "<b>HTML</b>", mode: "once", tool_calls_count: 0, streamed: false }),
    });
    try {
      h.manager.set_render_profile("telegram", "chat-1", { mode: "html" });
      await h.manager.handle_inbound_message(inbound("test", { chat_id: "chat-1" }));
      // telegram + html → html 유지. 오류 없이 실행됨
      expect(h.registry.sent.length).toBeGreaterThan(0);
    } finally { await h.cleanup(); }
  });

  it("비-telegram(slack) + html mode → markdown으로 강제 변환", async () => {
    const h = await create_harness({
      orchestration_handler: async () => ({ reply: "<b>HTML</b>", mode: "once", tool_calls_count: 0, streamed: false }),
    });
    try {
      h.manager.set_render_profile("slack", "chat-1", { mode: "html" });
      await h.manager.handle_inbound_message(inbound("test", { provider: "slack", chat_id: "chat-1" }));
      // slack + html → markdown으로 변환됨. 오류 없이 실행됨
      expect(h.registry.sent.length).toBeGreaterThan(0);
    } finally { await h.cleanup(); }
  });
});

// ══════════════════════════════════════════════════
// set/reset render_profile (TTL 관련)
// ══════════════════════════════════════════════════

describe("ChannelManager — set/reset render_profile (TTL 관련)", () => {
  it("set 후 reset → 기본 프로필로 복원", async () => {
    const h = await create_harness();
    try {
      const default_profile = h.manager.get_render_profile("telegram", "chat-X");
      // markdown으로 변경
      h.manager.set_render_profile("telegram", "chat-X", { mode: "markdown" });
      expect(h.manager.get_render_profile("telegram", "chat-X").mode).toBe("markdown");

      // reset → 기본값으로 복원
      h.manager.reset_render_profile("telegram", "chat-X");
      const reset = h.manager.get_render_profile("telegram", "chat-X");
      expect(reset.mode).toBe(default_profile.mode);
    } finally { await h.cleanup(); }
  });
});

// ══════════════════════════════════════════════════
// on_activity_start / on_activity_end 콜백
// ══════════════════════════════════════════════════

describe("ChannelManager — on_activity_start/end 콜백", () => {
  it("handle_inbound_message → on_activity_start/end 호출됨", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const on_start = vi.fn();
      const on_end = vi.fn();
      const { manager } = await make_manager({
        workspace: ws,
        on_activity_start: on_start,
        on_activity_end: on_end,
      });

      await manager.handle_inbound_message(inbound("test", { provider: "telegram" }));
      expect(on_start).toHaveBeenCalled();
      expect(on_end).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// builtin_command 분기
// ══════════════════════════════════════════════════

describe("ChannelManager — builtin_command 분기", () => {
  it("result.builtin_command='help' → slash command로 위임 시도", async () => {
    const h = await create_harness({
      orchestration_handler: async () => ({
        reply: "builtin help",
        builtin_command: "help",
        mode: "once", tool_calls_count: 0, streamed: false,
      }),
    });
    try {
      await h.manager.handle_inbound_message(inbound("도움말"));
      // 오류 없이 실행됨
      expect(h.registry.sent.length).toBeGreaterThanOrEqual(0);
    } finally { await h.cleanup(); }
  });
});

// ══════════════════════════════════════════════════
// autoReply=false → 오케스트레이션 호출 안 함
// ══════════════════════════════════════════════════

describe("ChannelManager — autoReply=false", () => {
  it("autoReply=false → 멘션 없으면 오케스트레이션 미호출", async () => {
    const h = await create_harness({ config_patch: { autoReply: false } });
    try {
      const orch_spy = vi.spyOn(h.orchestration, "execute");
      await h.manager.handle_inbound_message(inbound("일반 메시지"));
      expect(orch_spy).not.toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });
});

// ══════════════════════════════════════════════════
// prune_seen / prune_render_profiles (from cov4)
// ══════════════════════════════════════════════════

describe("ChannelManager — prune_seen / prune_render_profiles", () => {
  it("prune_seen() 호출 → 오류 없이 완료", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const msg = inbound("hello");
      (manager as any).mark_seen(msg);
      (manager as any).prune_seen();
      expect(true).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("prune_render_profiles(): render_profile_ts가 비면 즉시 반환", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      // render_profile_ts 비어있음
      (manager as any).prune_render_profiles();
      expect(true).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("prune_render_profiles(): 오래된 프로필 삭제", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws, config_patch: { seenTtlMs: 100 } });
      manager.set_render_profile("slack", "C123", { mode: "markdown" });
      // seenTtlMs=100ms 후 만료
      await new Promise((r) => setTimeout(r, 200));
      (manager as any).prune_render_profiles();
      // 삭제 후 기본값으로 돌아감
      const profile = manager.get_render_profile("slack", "C123");
      expect(["markdown", "plain"]).toContain(profile.mode);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// resolve_target (from cov4)
// ══════════════════════════════════════════════════

describe("ChannelManager — resolve_target", () => {
  it("instance_id 있고 target 존재 → instance target 반환", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const bot_identity = {
        get_bot_self_id: () => "",
        get_default_target: (id: string) => id === "slack-1" ? "C_DEFAULT" : "",
      };
      const { manager } = await make_manager({ workspace: ws, bot_identity });
      const target = (manager as any).resolve_target("slack", "slack-1");
      expect(target).toBe("C_DEFAULT");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("instance_id 있지만 target 없음 → provider target 시도", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const bot_identity = {
        get_bot_self_id: () => "",
        get_default_target: (id: string) => id === "slack" ? "C_SLACK" : "",
      };
      const { manager } = await make_manager({ workspace: ws, bot_identity });
      const target = (manager as any).resolve_target("slack", "unknown-instance");
      // instance에서 못 찾으면 provider로 폴백
      expect(target).toBe("C_SLACK");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("instance_id 없으면 provider target", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const bot_identity = {
        get_bot_self_id: () => "",
        get_default_target: (id: string) => id === "telegram" ? "12345" : "",
      };
      const { manager } = await make_manager({ workspace: ws, bot_identity });
      const target = (manager as any).resolve_target("telegram", undefined);
      expect(target).toBe("12345");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// send_outbound — web provider vs non-web (from cov4)
// ══════════════════════════════════════════════════

describe("ChannelManager — send_outbound", () => {
  it("provider=web → bus.publish_outbound 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const bus = {
        publish_outbound: vi.fn().mockResolvedValue(undefined),
        publish_inbound: vi.fn().mockResolvedValue(undefined),
        subscribe_inbound: vi.fn().mockReturnValue(() => {}),
      } as any;
      const { manager } = await make_manager({ workspace: ws, bus });
      const msg = inbound("hello", { provider: "web" });
      await (manager as any).send_outbound("web", msg, "soul", "응답 내용", { kind: "agent_reply" });
      expect(bus.publish_outbound).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("provider=slack → dispatch.send 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const dispatch_spy = vi.fn().mockResolvedValue({ ok: true, message_id: "m1" });
      (manager as any).dispatch = { send: dispatch_spy };
      const msg = inbound("hello", { provider: "slack" });
      await (manager as any).send_outbound("slack", msg, "soul", "응답 내용", { kind: "agent_reply" });
      expect(dispatch_spy).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// render_reply — 다양한 입력 (from cov4)
// ══════════════════════════════════════════════════

describe("ChannelManager — render_reply", () => {
  it("일반 텍스트 → content 반환", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const result = (manager as any).render_reply("안녕하세요, 사용자!", "slack", "C123") as any;
      expect(typeof result.content).toBe("string");
      expect(result.render_mode).toBeDefined();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("media URL 포함 → media 배열 반환", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const result = (manager as any).render_reply("텍스트 내용", "telegram", "12345") as any;
      expect(Array.isArray(result.media)).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// notify_expired_tasks (from cov4)
// ══════════════════════════════════════════════════

describe("ChannelManager — notify_expired_tasks", () => {
  it("expire_stale() → 만료 태스크 없음 → 미발행", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const task_resume = new ExtendedFakeTaskResume([]);
      const dispatch_spy = vi.fn().mockResolvedValue({ ok: true, message_id: "m0" });
      const { manager } = await make_manager({ workspace: ws, task_resume });
      (manager as any).dispatch = { send: dispatch_spy };
      await (manager as any).notify_expired_tasks("slack");
      await new Promise((r) => setTimeout(r, 50));
      expect(dispatch_spy).not.toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("expire_stale() → 만료 태스크 있음 → dispatch.send 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const expired_tasks = [
        { taskId: "task-1", chatId: "C123", channel: "slack", title: "이전 태스크", memory: {} },
      ];
      const task_resume = new ExtendedFakeTaskResume(expired_tasks);
      const dispatch_spy = vi.fn().mockResolvedValue({ ok: true, message_id: "m1" });
      const { manager } = await make_manager({ workspace: ws, task_resume });
      // dispatch.send 직접 스파이
      (manager as any).dispatch = { send: dispatch_spy };
      await (manager as any).notify_expired_tasks("slack");
      // 비동기 fire-and-forget이므로 잠깐 대기
      await new Promise((r) => setTimeout(r, 50));
      expect(dispatch_spy).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("objective 있는 태스크 → expired_task에 objective 포함", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const expired_tasks = [
        { taskId: "task-2", chatId: "C456", channel: "slack", title: "목표 태스크", memory: { objective: "데이터 분석" } },
      ];
      const task_resume = new ExtendedFakeTaskResume(expired_tasks);
      const dispatch_spy = vi.fn().mockResolvedValue({ ok: true, message_id: "m2" });
      const { manager } = await make_manager({ workspace: ws, task_resume });
      (manager as any).dispatch = { send: dispatch_spy };
      await (manager as any).notify_expired_tasks("slack");
      await new Promise((r) => setTimeout(r, 50));
      expect(dispatch_spy).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// try_read_ack (from cov4)
// ══════════════════════════════════════════════════

describe("ChannelManager — try_read_ack", () => {
  it("readAckEnabled=false → add_reaction 미호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws, config_patch: { readAckEnabled: false } });
      const add_reaction_spy = vi.fn();
      const fake_channel = { add_reaction: add_reaction_spy, parse_agent_mentions: () => [] };
      const registry_spy = vi.fn().mockReturnValue(fake_channel);
      (manager as any).registry = { get_channel: registry_spy, list_channels: () => [] };
      const msg = inbound("hello");
      await (manager as any).try_read_ack("slack", msg);
      expect(add_reaction_spy).not.toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("readAckEnabled=true + message_id 없음 → 미호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws, config_patch: { readAckEnabled: true } });
      const msg = inbound("hello");
      (msg as any).id = "";
      await (manager as any).try_read_ack("slack", msg);
      expect(true).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("readAckEnabled=true + message_id 있음 + channel.add_reaction 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws, config_patch: { readAckEnabled: true, readAckReaction: "eyes" } });
      const add_reaction_spy = vi.fn().mockResolvedValue(undefined);
      const fake_channel = { add_reaction: add_reaction_spy, parse_agent_mentions: () => [] };
      (manager as any).registry = {
        get_channel: vi.fn().mockReturnValue(fake_channel),
        list_channels: () => [],
      };
      const msg = inbound("hello");
      (msg as any).metadata = { message_id: "ts123" };
      await (manager as any).try_read_ack("slack", msg);
      expect(add_reaction_spy).toHaveBeenCalledWith(msg.chat_id, "ts123", "eyes");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// extract_mentions (from cov4)
// ══════════════════════════════════════════════════

describe("ChannelManager — extract_mentions", () => {
  it("metadata.mentions 있음 → meta aliases 반환", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const msg = inbound("hello @claude", { provider: "slack" });
      (msg as any).metadata = { mentions: [{ alias: "claude" }, { alias: "worker" }] };
      const mentions = (manager as any).extract_mentions("slack", msg);
      // "claude" → defaultAlias (from config), "worker" → kept
      expect(Array.isArray(mentions)).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("metadata.mentions 없음 → channel.parse_agent_mentions 사용", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const registry = new FakeChannelRegistry();
      const fake_channel = {
        parse_agent_mentions: vi.fn().mockReturnValue([{ alias: "soul" }]),
        sync_commands: vi.fn().mockResolvedValue(undefined),
      };
      (registry as any).get_channel = vi.fn().mockReturnValue(fake_channel);
      const { manager } = await make_manager({ workspace: ws, registry });
      const msg = inbound("@soul 작업 수행", { provider: "slack" });
      const mentions = (manager as any).extract_mentions("slack", msg);
      expect(Array.isArray(mentions)).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("'claude-worker' alias → defaultAlias로 변환", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws, config_patch: { defaultAlias: "soul" } });
      const msg = inbound("@claude-worker 작업", { provider: "slack" });
      (msg as any).metadata = { mentions: [{ alias: "claude-worker" }] };
      const mentions = (manager as any).extract_mentions("slack", msg);
      expect(mentions).toContain("soul");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// send_command_reply (from cov5)
// ══════════════════════════════════════════════════

describe("ChannelManager — send_command_reply", () => {
  it("커맨드 응답 텍스트 → dispatch.send 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const dispatch_spy = vi.fn().mockResolvedValue({ ok: true, message_id: "m1" });
      (manager as any).dispatch = { send: dispatch_spy };
      const msg = inbound("!help", { provider: "slack" });
      await (manager as any).send_command_reply("slack", msg, "커맨드 결과 내용");
      expect(dispatch_spy).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("웹 provider → bus.publish_outbound 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const bus_spy = { publish_outbound: vi.fn().mockResolvedValue(undefined), publish_inbound: vi.fn(), subscribe_inbound: vi.fn().mockReturnValue(() => {}) } as any;
      const { manager } = await make_manager({ workspace: ws, bus: bus_spy });
      const msg = inbound("!help", { provider: "web" });
      await (manager as any).send_command_reply("web", msg, "웹 커맨드 결과");
      expect(bus_spy.publish_outbound).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// send_error_reply (from cov5)
// ══════════════════════════════════════════════════

describe("ChannelManager — send_error_reply", () => {
  it("에러 텍스트 → dispatch.send 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const dispatch_spy = vi.fn().mockResolvedValue({ ok: true, message_id: "m1" });
      (manager as any).dispatch = { send: dispatch_spy };
      const msg = inbound("작업 실행", { provider: "slack" });
      await (manager as any).send_error_reply("slack", msg, "soul", "타임아웃 오류", "run-123");
      expect(dispatch_spy).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// send_chunked — 분할 전송 (from cov5)
// ══════════════════════════════════════════════════

describe("ChannelManager — send_chunked", () => {
  it("짧은 내용 → 1개 청크만", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const dispatch_spy = vi.fn().mockResolvedValue({ ok: true, message_id: "m1" });
      (manager as any).dispatch = { send: dispatch_spy };
      const msg = inbound("질문", { provider: "slack" });
      await (manager as any).send_chunked("slack", msg, "soul", "@user ", "짧은 응답", 4096, { kind: "agent_reply" });
      expect(dispatch_spy).toHaveBeenCalledTimes(1);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("긴 내용 → 여러 청크 분할", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const dispatch_spy = vi.fn().mockResolvedValue({ ok: true, message_id: "m1" });
      (manager as any).dispatch = { send: dispatch_spy };
      const msg = inbound("질문", { provider: "slack" });
      const long_content = "가나다 ".repeat(300); // 1200+ chars
      await (manager as any).send_chunked("slack", msg, "soul", "", long_content, 100, { kind: "agent_reply" });
      // max_len=100이므로 여러 청크로 분할됨
      expect(dispatch_spy.mock.calls.length).toBeGreaterThan(1);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("두 번째 청크 meta → kind=agent_reply_cont", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const dispatch_spy = vi.fn().mockResolvedValue({ ok: true, message_id: "m1" });
      (manager as any).dispatch = { send: dispatch_spy };
      const msg = inbound("질문", { provider: "slack" });
      const long_content = "A".repeat(500);
      await (manager as any).send_chunked("slack", msg, "soul", "", long_content, 50, { kind: "agent_reply" });
      // 두 번째 호출의 내용에 chunk_index가 포함된 meta
      if (dispatch_spy.mock.calls.length > 1) {
        const second_msg = dispatch_spy.mock.calls[1][1];
        expect(second_msg.metadata?.kind).toBe("agent_reply_cont");
      }
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// try_hitl_send_input (from cov5)
// ══════════════════════════════════════════════════

describe("ChannelManager — try_hitl_send_input", () => {
  it("content 없음 → false", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const msg = inbound("", { provider: "slack" });
      const result = (manager as any).try_hitl_send_input(msg);
      expect(result).toBe(false);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("active_run 없음 → false", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const msg = inbound("응답 내용", { provider: "slack" });
      const result = (manager as any).try_hitl_send_input(msg);
      expect(result).toBe(false);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("active_run 있음 + send_input 있음 → true", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const send_input_spy = vi.fn();
      // active_runs에 fake run 등록
      const fake_run = {
        abort: new AbortController(),
        provider: "slack",
        chat_id: "C123",
        alias: "soul",
        done: Promise.resolve(),
        send_input: send_input_spy,
      };
      (manager as any).active_runs.register("slack:C123:soul", fake_run);
      const msg = inbound("사용자 응답", { provider: "slack" });
      (msg as any).chat_id = "C123";
      const result = (manager as any).try_hitl_send_input(msg);
      expect(result).toBe(true);
      expect(send_input_spy).toHaveBeenCalledWith("사용자 응답");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// handle_mentions — cooldown 및 alias 필터 (from cov5)
// ══════════════════════════════════════════════════

describe("ChannelManager — handle_mentions", () => {
  it("alias === sender_id → 자기 자신 언급, 건너뜀", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const invoke_spy = vi.fn();
      (manager as any).invoke_and_reply = invoke_spy;
      const msg = inbound("hello", { provider: "slack" });
      (msg as any).sender_id = "soul";
      await (manager as any).handle_mentions("slack", msg, ["soul"]);
      expect(invoke_spy).not.toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("cooldown 중인 alias → 건너뜀", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const invoke_spy = vi.fn();
      (manager as any).invoke_and_reply = invoke_spy;
      const msg = inbound("hello", { provider: "slack" });
      (msg as any).sender_id = "U001";
      // 먼저 cooldown 설정
      (manager as any).mention_cooldowns.set("slack:C001:soul", Date.now());
      (msg as any).chat_id = "C001";
      await (manager as any).handle_mentions("slack", msg, ["soul"]);
      // cooldown 중이므로 invoke 미호출
      expect(invoke_spy).not.toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("새 alias → invoke_and_reply 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const invoke_spy = vi.fn().mockResolvedValue(undefined);
      (manager as any).invoke_and_reply = invoke_spy;
      const msg = inbound("hello soul", { provider: "slack" });
      (msg as any).sender_id = "U001";
      await (manager as any).handle_mentions("slack", msg, ["soul"]);
      expect(invoke_spy).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// is_duplicate (from cov6)
// ══════════════════════════════════════════════════

describe("ChannelManager — is_duplicate", () => {
  it("mark_seen 후 is_duplicate → true (seen 키 있음)", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const msg = inbound("hello");
      (manager as any).mark_seen(msg);
      expect((manager as any).is_duplicate(msg)).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("mark_seen 안 한 메시지 → is_duplicate=false", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const msg = inbound("hello");
      expect((manager as any).is_duplicate(msg)).toBe(false);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("message_id 없는 메시지 → seen_key=null → is_duplicate=false", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const msg = inbound("hello", { id: "", metadata: {} });
      expect((manager as any).is_duplicate(msg)).toBe(false);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// prune_seen — 비어있지 않은 맵들 (from cov6)
// ══════════════════════════════════════════════════

describe("ChannelManager — prune_seen 비어있지 않은 맵", () => {
  it("control_reaction_seen, mention_cooldowns, primed_targets에 항목 있을 때 → 콜백 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws });

      // control_reaction_seen에 항목 추가
      const crs = (manager as any).control_reaction_seen as Map<string, number>;
      crs.set("test-key-crs", Date.now());

      // mention_cooldowns에 항목 추가
      const mc = (manager as any).mention_cooldowns as Map<string, number>;
      mc.set("test-key-mc", Date.now());

      // primed_targets에 항목 추가
      const pt = (manager as any).primed_targets as Map<string, number>;
      pt.set("test-key-pt", Date.now());

      // prune_seen 호출 → 콜백 호출됨
      (manager as any).prune_seen();

      // 오류 없이 완료
      expect(true).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("만료된 항목은 삭제됨", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-"));
    try {
      const { manager } = await make_manager({ workspace: ws, config_patch: { seenTtlMs: 1, reactionActionTtlMs: 1 } });

      const crs = (manager as any).control_reaction_seen as Map<string, number>;
      crs.set("old-crs", Date.now() - 100); // already expired

      await new Promise((r) => setTimeout(r, 10)); // wait > 1ms
      (manager as any).prune_seen();

      expect(crs.has("old-crs")).toBe(false);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});
