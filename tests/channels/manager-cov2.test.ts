/**
 * ChannelManager.handle_inbound_message — 미커버 분기 커버리지.
 * _should_ignore 다양한 조건 + handle_inbound_message 주요 경로 테스트.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChannelManager } from "@src/channels/manager.js";
import type { ChannelManagerDeps } from "@src/channels/manager.js";

// ── 헬퍼 ─────────────────────────────────────────────────

function make_deps(overrides: Partial<ChannelManagerDeps> = {}): ChannelManagerDeps {
  return {
    bus: {
      publish: vi.fn().mockResolvedValue(undefined),
      publish_outbound: vi.fn().mockResolvedValue(undefined),
      publish_progress: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(),
      get_size: vi.fn().mockReturnValue(0),
      get_sizes: vi.fn().mockReturnValue({ inbound: 0, outbound: 0, total: 0 }),
    } as any,
    registry: {
      start_all: vi.fn().mockResolvedValue(undefined),
      stop_all: vi.fn().mockResolvedValue(undefined),
      list_channels: vi.fn().mockReturnValue([]),
      get_channel: vi.fn().mockReturnValue(null),
      get_health: vi.fn().mockReturnValue([]),
      set_typing: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(),
      register: vi.fn(),
      unregister: vi.fn(),
    } as any,
    dispatch: { dispatch: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue({ message_id: "m1" }) } as any,
    command_router: {
      try_handle: vi.fn().mockResolvedValue(false),
    } as any,
    orchestration: {
      execute: vi.fn().mockResolvedValue({ reply: "ok", mode: "once", tool_calls_count: 0, streamed: false }),
    } as any,
    approval: {
      try_handle_text_reply: vi.fn().mockResolvedValue({ handled: false }),
      try_handle_reaction: vi.fn().mockResolvedValue({ handled: false }),
    } as any,
    task_resume: {
      try_resume: vi.fn().mockResolvedValue(null),
      resume_after_approval: vi.fn().mockResolvedValue(true),
      cancel_task: vi.fn().mockResolvedValue(undefined),
      get_pending_task: vi.fn().mockResolvedValue(null),
      expire_stale: vi.fn().mockReturnValue([]),
    } as any,
    session_recorder: {
      record_user: vi.fn().mockResolvedValue(undefined),
      record_assistant: vi.fn().mockResolvedValue(undefined),
      get_history: vi.fn().mockResolvedValue([]),
    } as any,
    media_collector: {
      collect_for_message: vi.fn().mockResolvedValue([]),
    } as any,
    process_tracker: null,
    providers: null,
    config: {
      defaultAlias: "assistant",
      inboundConcurrency: 4,
      autoReply: false,
      readLimit: 10,
      approvalReactionEnabled: false,
      sessionHistoryMaxAgeMs: 1_800_000,
      streaming: { enabled: false, mode: "inline", intervalMs: 1400, minChars: 48, suppressFinalAfterStream: false, toolDisplay: "count" },
    } as any,
    workspace_dir: "/tmp/test",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    bot_identity: {
      get_bot_self_id: vi.fn().mockReturnValue("bot-id"),
      get_default_target: vi.fn().mockReturnValue("default-chat"),
    } as any,
    active_run_controller: {
      size: 0, cancel: vi.fn().mockReturnValue(0),
      get: vi.fn(), register: vi.fn(), unregister: vi.fn(),
    } as any,
    render_profile_store: {
      get: vi.fn().mockReturnValue({ mode: "markdown", max_length: 4000, link_policy: null, image_policy: null }),
      set: vi.fn().mockImplementation((_p, _c, patch) => ({ mode: "markdown", max_length: 4000, ...patch })),
      reset: vi.fn().mockReturnValue({ mode: "markdown", max_length: 4000 }),
    } as any,
    ...overrides,
  };
}

function make_message(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    provider: "slack",
    channel: "slack",
    chat_id: "C123",
    sender_id: "U001",
    content: "hello",
    at: new Date().toISOString(),
    thread_id: undefined,
    metadata: {},
    ...overrides,
  } as any;
}

beforeEach(() => vi.clearAllMocks());

// ══════════════════════════════════════════════════════════
// _should_ignore 분기들
// ══════════════════════════════════════════════════════════

describe("ChannelManager — _should_ignore 분기", () => {
  it("sender_id='' → 무시됨 (즉시 반환)", async () => {
    const manager = new ChannelManager(make_deps());
    const msg = make_message({ sender_id: "" });
    // _should_ignore → true → handle_inbound_message returns immediately
    await manager.handle_inbound_message(msg);
    // approval.try_handle_text_reply는 호출되지 않음
    const deps = make_deps();
    // 별도 인스턴스로 확인
    const m2 = new ChannelManager(deps);
    await m2.handle_inbound_message(make_message({ sender_id: "unknown" }));
    expect((deps.approval.try_handle_text_reply as any)).not.toHaveBeenCalled();
  });

  it("sender_id='subagent:abc' → 무시됨", async () => {
    const deps = make_deps();
    const manager = new ChannelManager(deps);
    await manager.handle_inbound_message(make_message({ sender_id: "subagent:abc-123" }));
    expect((deps.approval.try_handle_text_reply as any)).not.toHaveBeenCalled();
  });

  it("sender_id='approval-bot' → 무시됨", async () => {
    const deps = make_deps();
    const manager = new ChannelManager(deps);
    await manager.handle_inbound_message(make_message({ sender_id: "approval-bot" }));
    expect((deps.approval.try_handle_text_reply as any)).not.toHaveBeenCalled();
  });

  it("metadata.from_is_bot=true → 무시됨", async () => {
    const deps = make_deps();
    const manager = new ChannelManager(deps);
    await manager.handle_inbound_message(make_message({ metadata: { from_is_bot: true } }));
    expect((deps.approval.try_handle_text_reply as any)).not.toHaveBeenCalled();
  });

  it("metadata.kind='task_recovery' → 무시됨", async () => {
    const deps = make_deps();
    const manager = new ChannelManager(deps);
    await manager.handle_inbound_message(make_message({ metadata: { kind: "task_recovery" } }));
    expect((deps.approval.try_handle_text_reply as any)).not.toHaveBeenCalled();
  });

  it("metadata.slack.bot_id 있음 → 무시됨 (Slack 봇 메시지)", async () => {
    const deps = make_deps();
    const manager = new ChannelManager(deps);
    await manager.handle_inbound_message(make_message({
      metadata: { slack: { bot_id: "B001", subtype: "" } },
    }));
    expect((deps.approval.try_handle_text_reply as any)).not.toHaveBeenCalled();
  });

  it("metadata.slack.subtype='bot_message' → 무시됨", async () => {
    const deps = make_deps();
    const manager = new ChannelManager(deps);
    await manager.handle_inbound_message(make_message({
      metadata: { slack: { bot_id: "", subtype: "bot_message" } },
    }));
    expect((deps.approval.try_handle_text_reply as any)).not.toHaveBeenCalled();
  });

  it("metadata.slack.subtype='message_changed' → 무시됨", async () => {
    const deps = make_deps();
    const manager = new ChannelManager(deps);
    await manager.handle_inbound_message(make_message({
      metadata: { slack: { bot_id: "", subtype: "message_changed" } },
    }));
    expect((deps.approval.try_handle_text_reply as any)).not.toHaveBeenCalled();
  });

  it("정상 메시지 → _should_ignore=false → approval.try_handle_text_reply 호출됨", async () => {
    const deps = make_deps();
    const manager = new ChannelManager(deps);
    await manager.handle_inbound_message(make_message({ sender_id: "U001" }));
    expect((deps.approval.try_handle_text_reply as any)).toHaveBeenCalledOnce();
  });
});

// ══════════════════════════════════════════════════════════
// handle_inbound_message — approval 경로
// ══════════════════════════════════════════════════════════

describe("ChannelManager — handle_inbound_message approval 경로", () => {
  it("approval.handled=true + task_id + tool_result → resume_after_approval 호출", async () => {
    const deps = make_deps();
    (deps.approval.try_handle_text_reply as any).mockResolvedValue({
      handled: true,
      task_id: "task-1",
      tool_result: { result: "ok" },
    });
    const manager = new ChannelManager(deps);
    await manager.handle_inbound_message(make_message({ sender_id: "U001" }));
    expect((deps.task_resume.resume_after_approval as any)).toHaveBeenCalledWith("task-1", { result: "ok" });
  });

  it("resume_after_approval=false → approval_resume_failed 로그", async () => {
    const deps = make_deps();
    (deps.approval.try_handle_text_reply as any).mockResolvedValue({
      handled: true,
      task_id: "task-2",
      tool_result: { result: "ok" },
    });
    (deps.task_resume.resume_after_approval as any).mockResolvedValue(false);
    const manager = new ChannelManager(deps);
    await manager.handle_inbound_message(make_message({ sender_id: "U001" }));
    expect((deps.logger.warn as any)).toHaveBeenCalledWith("approval_resume_failed", expect.any(Object));
  });

  it("approval.handled=true + denial status → cancel_task 호출", async () => {
    const deps = make_deps();
    (deps.approval.try_handle_text_reply as any).mockResolvedValue({
      handled: true,
      task_id: "task-3",
      tool_result: null,
      approval_status: "denied",
    });
    const manager = new ChannelManager(deps);
    await manager.handle_inbound_message(make_message({ sender_id: "U001" }));
    expect((deps.task_resume.cancel_task as any)).toHaveBeenCalledWith("task-3", "approval_denied");
  });

  it("approval.handled=true + cancelled status → cancel_task 호출", async () => {
    const deps = make_deps();
    (deps.approval.try_handle_text_reply as any).mockResolvedValue({
      handled: true,
      task_id: "task-4",
      tool_result: null,
      approval_status: "cancelled",
    });
    const manager = new ChannelManager(deps);
    await manager.handle_inbound_message(make_message({ sender_id: "U001" }));
    expect((deps.task_resume.cancel_task as any)).toHaveBeenCalledWith("task-4", "approval_cancelled");
  });
});

// ══════════════════════════════════════════════════════════
// resolve_provider → null (provider 없는 경우)
// ══════════════════════════════════════════════════════════

describe("ChannelManager — provider 없는 메시지", () => {
  it("provider/channel 모두 없음 → 즉시 반환 (approval 미호출)", async () => {
    const deps = make_deps();
    const manager = new ChannelManager(deps);
    await manager.handle_inbound_message(
      make_message({ provider: undefined, channel: undefined, sender_id: "U001" })
    );
    expect((deps.approval.try_handle_text_reply as any)).not.toHaveBeenCalled();
  });
});
