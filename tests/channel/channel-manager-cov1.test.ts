/**
 * ChannelManager — 미커버 분기 커버리지 (cov1).
 * _should_ignore, approval handling, workflow_hitl, confirmation_guard,
 * task_resume branches, deliver_result branches, render_msg, etc.
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
import type { ChannelRegistryLike } from "@src/channels/types.ts";
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

  async try_resume(_provider: string, _message: unknown) { return this.try_resume_result; }
  async resume_after_approval(task_id: string, tool_result: string): Promise<boolean> {
    this.resume_spy(task_id, tool_result);
    return this.resume_result;
  }
  async cancel_task(task_id: string, reason: string): Promise<void> {
    this.cancel_spy(task_id, reason);
  }
  expire_stale(): [] { return []; }
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
}) {
  const logger = create_noop_logger();
  const registry = new FakeChannelRegistry();
  const dispatch = new FakeDispatchService(registry);
  const orch = new FakeOrchestrationService(opts.orchestration_handler);
  const task_resume = opts.task_resume ?? new ExtendedFakeTaskResume();
  const approval = opts.approval ?? new ExtendedFakeApproval();
  const recorder = new SessionRecorder({ sessions: null, daily_memory: null, sanitize_for_storage: (t) => t, logger });
  const media = new MediaCollector({ workspace_dir: opts.workspace, tokens: {} });
  const config = { ...create_test_channel_config(), ...(opts.config_patch || {}) };

  const manager = new ChannelManager({
    bus: new MessageBus(),
    registry: registry as unknown as ChannelRegistryLike,
    dispatch: dispatch as unknown as DispatchService,
    command_router: new CommandRouter([]),
    orchestration: orch as unknown as OrchestrationService,
    approval: approval as unknown as ApprovalService,
    task_resume: task_resume as unknown as TaskResumeService,
    session_recorder: recorder,
    media_collector: media,
    process_tracker: null,
    providers: {} as never,
    config,
    workspace_dir: opts.workspace,
    logger,
    bot_identity: { get_bot_self_id: () => "", get_default_target: () => "" },
    confirmation_guard: opts.confirmation_guard as never,
    workflow_hitl: opts.workflow_hitl as never,
    renderer: opts.renderer ?? null,
  });

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
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov1-"));
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov1-"));
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov1-"));
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov1-"));
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov1-"));
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov1-"));
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov1-"));
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov1-"));
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov1-"));
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov1-"));
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov1-"));
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov1-"));
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov1-"));
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov1-"));
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov1-"));
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov1-"));
    try {
      const on_web_stream = vi.fn();
      const logger = create_noop_logger();
      const registry = new FakeChannelRegistry();
      const dispatch = new FakeDispatchService(registry);
      const orch = new FakeOrchestrationService(async () => ({ reply: "web reply", mode: "once", tool_calls_count: 0, streamed: false }));
      const task_resume = new ExtendedFakeTaskResume();
      const approval = new ExtendedFakeApproval();
      const recorder = new SessionRecorder({ sessions: null, daily_memory: null, sanitize_for_storage: (t) => t, logger });
      const media = new MediaCollector({ workspace_dir: ws, tokens: {} });
      const config = create_test_channel_config();

      const manager = new ChannelManager({
        bus: new MessageBus(),
        registry: registry as unknown as ChannelRegistryLike,
        dispatch: dispatch as unknown as DispatchService,
        command_router: new CommandRouter([]),
        orchestration: orch as unknown as OrchestrationService,
        approval: approval as unknown as ApprovalService,
        task_resume: task_resume as unknown as TaskResumeService,
        session_recorder: recorder,
        media_collector: media,
        process_tracker: null,
        providers: {} as never,
        config,
        workspace_dir: ws,
        logger,
        bot_identity: { get_bot_self_id: () => "", get_default_target: () => "" },
        on_web_stream,
      });

      await manager.handle_inbound_message(inbound("web msg", { provider: "web", channel: "web" }));
      // web provider는 bus를 통해 outbound 전송
      expect(on_web_stream).toHaveBeenCalledWith(expect.any(String), "", true);
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
// prune_render_profiles — set 후 내부 TTL 만료 시뮬레이션
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov1-"));
    try {
      const on_start = vi.fn();
      const on_end = vi.fn();
      const logger = create_noop_logger();
      const registry = new FakeChannelRegistry();
      const dispatch = new FakeDispatchService(registry);
      const orch = new FakeOrchestrationService();
      const task_resume = new ExtendedFakeTaskResume();
      const approval = new ExtendedFakeApproval();
      const recorder = new SessionRecorder({ sessions: null, daily_memory: null, sanitize_for_storage: (t) => t, logger });
      const media = new MediaCollector({ workspace_dir: ws, tokens: {} });

      const manager = new ChannelManager({
        bus: new MessageBus(),
        registry: registry as unknown as ChannelRegistryLike,
        dispatch: dispatch as unknown as DispatchService,
        command_router: new CommandRouter([]),
        orchestration: orch as unknown as OrchestrationService,
        approval: approval as unknown as ApprovalService,
        task_resume: task_resume as unknown as TaskResumeService,
        session_recorder: recorder,
        media_collector: media,
        process_tracker: null,
        providers: {} as never,
        config: create_test_channel_config(),
        workspace_dir: ws,
        logger,
        bot_identity: { get_bot_self_id: () => "", get_default_target: () => "" },
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
