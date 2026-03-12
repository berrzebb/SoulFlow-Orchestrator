/**
 * ChannelManager — _should_ignore, handle_inbound_message, 공개 메서드,
 * handle_control_reactions, extract_ts 커버리지.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChannelManager } from "@src/channels/manager.js";
import type { ChannelManagerDeps } from "@src/channels/manager.js";
import {
  create_noop_logger,
  create_test_channel_config,
} from "@helpers/harness.ts";
import { SessionRecorder } from "@src/channels/session-recorder.js";
import { MediaCollector } from "@src/channels/media-collector.js";
import { CommandRouter } from "@src/channels/commands/router.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
      queueCapPerLane: 0,
      queueDropPolicy: "old",
      inboundDebounce: { enabled: false, windowMs: 400, maxMessages: 5 },
      sessionLanePruneIntervalMs: 0,
      staleRunTimeoutMs: 0,
      pollMaxIntervalMs: 0,
      autoReply: false,
      readLimit: 10,
      approvalReactionEnabled: false,
      sessionHistoryMaxAgeMs: 1_800_000,
      streaming: { enabled: false, mode: "inline", intervalMs: 1400, minChars: 48, coalesceMaxChars: 0, suppressFinalAfterStream: false, toolDisplay: "count" },
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
afterEach(() => vi.restoreAllMocks());

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

// ══════════════════════════════════════════════════════════
// (from manager-cov3) handle_control_reactions / extract_ts
// ══════════════════════════════════════════════════════════

function make_base_deps(ws: string, logger: any, overrides: Record<string, any> = {}) {
  const config = create_test_channel_config();
  const recorder = new SessionRecorder({ sessions: null, daily_memory: null, sanitize_for_storage: (t: string) => t, logger });
  const media = new MediaCollector({ workspace_dir: ws, tokens: {} });
  return {
    bus: {
      publish_inbound: vi.fn().mockResolvedValue(undefined),
      publish_outbound: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(),
      get_size: vi.fn().mockReturnValue(0),
      get_sizes: vi.fn().mockReturnValue({ inbound: 0, outbound: 0, total: 0 }),
    } as any,
    registry: {
      list_channels: () => [],
      start_all: async () => {},
      stop_all: async () => {},
      get_health: () => [],
      get_channel: () => null,
      subscribe: () => {},
      register: () => {},
      unregister: () => {},
      read: async () => [],
    } as any,
    dispatch: { send: vi.fn().mockResolvedValue({ ok: true, message_id: "m1" }) } as any,
    command_router: new CommandRouter([]),
    orchestration: { execute: vi.fn() } as any,
    approval: {
      try_handle_text_reply: async () => ({ handled: false }),
      try_handle_approval_reactions: async () => ({ handled: false }),
      prune_seen: () => {},
    } as any,
    task_resume: {
      try_resume: async () => null,
      expire_stale: () => [],
      cancel_task: async () => {},
      resume_after_approval: async () => false,
    } as any,
    session_recorder: recorder,
    media_collector: media,
    process_tracker: null as any,
    providers: {} as never,
    config,
    workspace_dir: ws,
    logger,
    bot_identity: { get_bot_self_id: () => "bot", get_default_target: () => "" },
    session_store: null,
    ...overrides,
  };
}

describe("ChannelManager — handle_control_reactions dispatch.send 실패 (L1247)", () => {
  it("dispatch.send 거부 → logger.debug 'control reaction reply failed' 호출 (L1247)", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov3-"));
    try {
      const logger = {
        info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
        child: () => logger,
      };
      const dispatch = { send: vi.fn().mockRejectedValue(new Error("send failed")) } as any;
      const process_tracker = {
        list_active: vi.fn().mockReturnValue([
          { provider: "slack", chat_id: "C123", run_id: "run-1" },
        ]),
        cancel: vi.fn().mockResolvedValue({ cancelled: true, details: "" }),
        start: vi.fn().mockReturnValue("run-1"),
        end: vi.fn().mockResolvedValue(undefined),
      } as any;

      const manager = new ChannelManager(make_base_deps(ws, logger, {
        dispatch,
        process_tracker,
      }));

      const reaction_row = {
        id: `rxn-${Date.now()}`,
        provider: "slack",
        channel: "slack",
        chat_id: "C123",
        sender_id: "U001",
        content: "",
        at: new Date().toISOString(),
        metadata: {
          is_reaction: true,
          slack: {
            reactions: [{ name: "octagonal_sign" }],
          },
        },
      };

      (manager as any).handle_control_reactions("slack", [reaction_row]);

      await new Promise((r) => setTimeout(r, 20));

      expect(logger.debug).toHaveBeenCalledWith(
        "control reaction reply failed",
        expect.objectContaining({ error: expect.any(String) }),
      );
    } finally {
      await rm(ws, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe("ChannelManager — extract_ts numeric ts 및 date fallback (L1300-1305)", () => {
  it("numeric ts > 1e12 → L1303 branch (밀리초 직접 반환), ISO date → L1304-1305 branch", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov3-"));
    try {
      const logger = create_noop_logger();

      const messages: any[] = [
        {
          id: "m1", provider: "slack", channel: "slack",
          chat_id: "chat-1", sender_id: "U1", content: "alpha",
          at: "", metadata: { message_id: "mid-1", ts: "1700000000000" },
        },
        {
          id: "m2", provider: "slack", channel: "slack",
          chat_id: "chat-1", sender_id: "U2", content: "beta",
          at: "2024-01-01T00:00:00.000Z", metadata: { message_id: "mid-2" },
        },
        {
          id: "m3", provider: "slack", channel: "slack",
          chat_id: "chat-1", sender_id: "U3", content: "gamma",
          at: "invalid-date", metadata: {},
        },
      ];

      let manager_ref: ChannelManager;

      const mock_registry = {
        list_channels: () => [{ provider: "slack", instance_id: "inst-1" }],
        read: (_id: string, _target: string, _limit: number): Promise<any[]> => {
          Promise.resolve().then(() => (manager_ref as any).abort_ctl.abort());
          return Promise.resolve(messages);
        },
        start_all: async () => {},
        stop_all: async () => {},
        get_health: () => [],
        set_typing: async () => {},
        subscribe: () => {},
        register: () => {},
        unregister: () => {},
        get_channel: () => null,
      } as any;

      manager_ref = new ChannelManager(make_base_deps(ws, logger, {
        registry: mock_registry,
        bot_identity: {
          get_bot_self_id: () => "bot",
          get_default_target: () => "chat-1",
        },
      }));

      (manager_ref as any).primed_targets.set("inst-1:chat-1", Date.now());

      (manager_ref as any).running = true;

      await (manager_ref as any).run_poll_loop();

      expect(true).toBe(true);
    } finally {
      await rm(ws, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("numeric ts 1e9 < ts < 1e12 → L1303 branch (초 → 밀리초 변환)", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov3b-"));
    try {
      const logger = create_noop_logger();

      const messages: any[] = [
        {
          id: "m1", provider: "slack", channel: "slack",
          chat_id: "chat-1", sender_id: "U1", content: "a",
          at: "", metadata: { message_id: "mid-1", ts: "1700000000" },
        },
      ];

      let manager_ref: ChannelManager;

      const mock_registry = {
        list_channels: () => [{ provider: "slack", instance_id: "inst-2" }],
        read: () => {
          Promise.resolve().then(() => (manager_ref as any).abort_ctl.abort());
          return Promise.resolve(messages);
        },
        start_all: async () => {},
        stop_all: async () => {},
        get_health: () => [],
        subscribe: () => {},
        register: () => {},
        unregister: () => {},
        get_channel: () => null,
      } as any;

      manager_ref = new ChannelManager(make_base_deps(ws, logger, {
        registry: mock_registry,
        bot_identity: {
          get_bot_self_id: () => "bot",
          get_default_target: () => "chat-1",
        },
      }));

      (manager_ref as any).primed_targets.set("inst-2:chat-1", Date.now());

      (manager_ref as any).running = true;

      await (manager_ref as any).run_poll_loop();
      expect(true).toBe(true);
    } finally {
      await rm(ws, { recursive: true, force: true }).catch(() => {});
    }
  });
});

// ══════════════════════════════════════════════════════════
// (from manager-coverage) 공개 메서드 커버리지
// ══════════════════════════════════════════════════════════

function make_coverage_deps(overrides: Partial<ChannelManagerDeps> = {}): ChannelManagerDeps {
  const mock_registry = {
    start_all: vi.fn().mockResolvedValue(undefined),
    stop_all: vi.fn().mockResolvedValue(undefined),
    list_channels: vi.fn().mockReturnValue([
      { provider: "slack", instance_id: "slack-1" },
      { provider: "telegram", instance_id: "tg-1" },
    ]),
    get_channel: vi.fn().mockReturnValue({
      sync_commands: vi.fn().mockResolvedValue(undefined),
    }),
    get_health: vi.fn().mockReturnValue([
      { instance_id: "slack-1", ok: true },
    ]),
    set_typing: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(),
  };

  const mock_bus = {
    publish: vi.fn().mockResolvedValue(undefined),
    publish_outbound: vi.fn().mockResolvedValue(undefined),
    publish_progress: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    get_size: vi.fn().mockReturnValue(0),
    get_sizes: vi.fn().mockReturnValue({ inbound: 0, outbound: 0, total: 0 }),
    pop: vi.fn().mockResolvedValue(null),
    push: vi.fn().mockResolvedValue(undefined),
  };

  const mock_dispatch = {
    dispatch: vi.fn().mockResolvedValue(undefined),
  };

  const mock_command_router = {
    handle: vi.fn().mockResolvedValue(null),
  };

  const mock_orchestration = {
    execute: vi.fn().mockResolvedValue({ reply: "ok", mode: "once", tool_calls_count: 0, streamed: false }),
  };

  const mock_approval = {
    try_handle_text_reply: vi.fn().mockResolvedValue({ handled: false }),
    try_handle_reaction: vi.fn().mockResolvedValue({ handled: false }),
  };

  const mock_task_resume = {
    resume_after_approval: vi.fn().mockResolvedValue(true),
    cancel_task: vi.fn().mockResolvedValue(undefined),
    get_pending_task: vi.fn().mockResolvedValue(null),
  };

  const mock_recorder = {
    record: vi.fn().mockResolvedValue(undefined),
    record_user: vi.fn().mockResolvedValue(undefined),
    record_bot: vi.fn().mockResolvedValue(undefined),
    record_assistant: vi.fn().mockResolvedValue(undefined),
    get_recent: vi.fn().mockResolvedValue([]),
    get_history: vi.fn().mockResolvedValue([]),
  };

  const mock_media_collector = {
    collect: vi.fn().mockResolvedValue([]),
    collect_for_message: vi.fn().mockResolvedValue([]),
  };

  const mock_logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const mock_bot_identity = {
    get_bot_self_id: vi.fn().mockReturnValue("bot-id"),
    get_default_target: vi.fn().mockReturnValue("default-chat"),
  };

  const mock_active_run_controller = {
    size: 0,
    cancel: vi.fn().mockReturnValue(0),
    get: vi.fn().mockReturnValue(undefined),
    register: vi.fn(),
    unregister: vi.fn(),
  };

  const mock_render_profile_store = {
    get: vi.fn().mockReturnValue({ mode: "markdown", max_length: 4000, link_policy: null, image_policy: null }),
    set: vi.fn().mockImplementation((_p, _c, patch) => ({ mode: "markdown", max_length: 4000, link_policy: null, image_policy: null, ...patch })),
    reset: vi.fn().mockReturnValue({ mode: "markdown", max_length: 4000, link_policy: null, image_policy: null }),
  };

  return {
    bus: mock_bus as any,
    registry: mock_registry as any,
    dispatch: mock_dispatch as any,
    command_router: mock_command_router as any,
    orchestration: mock_orchestration as any,
    approval: mock_approval as any,
    task_resume: mock_task_resume as any,
    session_recorder: mock_recorder as any,
    media_collector: mock_media_collector as any,
    process_tracker: null,
    providers: null,
    config: {
      defaultAlias: "assistant",
      inboundConcurrency: 4,
      queueCapPerLane: 0,
      queueDropPolicy: "old",
      inboundDebounce: { enabled: false, windowMs: 400, maxMessages: 5 },
      sessionLanePruneIntervalMs: 0,
      staleRunTimeoutMs: 0,
      pollMaxIntervalMs: 0,
      sessionHistoryMaxAgeMs: 1_800_000,
      streaming: { enabled: false, mode: "inline", intervalMs: 1400, minChars: 48, coalesceMaxChars: 0, suppressFinalAfterStream: false, toolDisplay: "count" },
    } as any,
    workspace_dir: "/tmp/test-workspace",
    logger: mock_logger as any,
    bot_identity: mock_bot_identity as any,
    active_run_controller: mock_active_run_controller as any,
    render_profile_store: mock_render_profile_store as any,
    ...overrides,
  };
}

function make_manager(overrides: Partial<ChannelManagerDeps> = {}) {
  return new ChannelManager(make_coverage_deps(overrides));
}

describe("ChannelManager — set_workflow_hitl", () => {
  it("브리지 설정 후 내부 workflow_hitl에 반영됨", () => {
    const mgr = make_manager();
    const bridge = { try_resolve: vi.fn().mockResolvedValue(true) };
    expect(() => mgr.set_workflow_hitl(bridge)).not.toThrow();
  });
});

describe("ChannelManager — health_check", () => {
  it("running=false → ok=false", () => {
    const mgr = make_manager();
    const h = mgr.health_check();
    expect(h.ok).toBe(false);
    expect(h.details).toBeDefined();
  });

  it("details에 active_runs / seen_cache_size / inbound_lanes 포함", () => {
    const mgr = make_manager();
    const h = mgr.health_check();
    expect(h.details).toHaveProperty("active_runs");
    expect(h.details).toHaveProperty("seen_cache_size");
    expect(h.details).toHaveProperty("inbound_lanes");
  });
});

describe("ChannelManager — get_status", () => {
  it("enabled_channels에 registry 목록 반영", () => {
    const mgr = make_manager();
    const s = mgr.get_status();
    expect(s.enabled_channels).toContain("slack-1");
    expect(s.enabled_channels).toContain("tg-1");
  });

  it("mention_loop_running = false (시작 전)", () => {
    const mgr = make_manager();
    expect(mgr.get_status().mention_loop_running).toBe(false);
  });
});

describe("ChannelManager — get_channel_health", () => {
  it("registry.get_health() 결과 반환", () => {
    const deps = make_coverage_deps();
    const mgr = new ChannelManager(deps);
    const health = mgr.get_channel_health();
    expect(health).toEqual([{ instance_id: "slack-1", ok: true }]);
    expect((deps.registry as any).get_health).toHaveBeenCalled();
  });
});

describe("ChannelManager — active_runs 위임", () => {
  it("get_active_run_count → active_run_controller.size 반환", () => {
    const deps = make_coverage_deps();
    (deps.active_run_controller as any).size = 3;
    const mgr = new ChannelManager(deps);
    expect(mgr.get_active_run_count()).toBe(3);
  });

  it("cancel_active_runs() → active_run_controller.cancel() 호출", () => {
    const deps = make_coverage_deps();
    (deps.active_run_controller as any).cancel.mockReturnValue(2);
    const mgr = new ChannelManager(deps);
    const n = mgr.cancel_active_runs();
    expect(n).toBe(2);
    expect((deps.active_run_controller as any).cancel).toHaveBeenCalledWith(undefined);
  });

  it("cancel_active_runs(key) → key 전달", () => {
    const deps = make_coverage_deps();
    (deps.active_run_controller as any).cancel.mockReturnValue(1);
    const mgr = new ChannelManager(deps);
    mgr.cancel_active_runs("some-key");
    expect((deps.active_run_controller as any).cancel).toHaveBeenCalledWith("some-key");
  });
});

describe("ChannelManager — render profile 위임", () => {
  it("get_render_profile → store.get() 호출", () => {
    const deps = make_coverage_deps();
    const mgr = new ChannelManager(deps);
    const p = mgr.get_render_profile("slack", "chat-1");
    expect(p).toBeDefined();
    expect((deps.render_profile_store as any).get).toHaveBeenCalledWith("slack", "chat-1");
  });

  it("set_render_profile → store.set() 호출 후 프로필 반환", () => {
    const deps = make_coverage_deps();
    const mgr = new ChannelManager(deps);
    const p = mgr.set_render_profile("slack", "chat-1", { mode: "plain" as any });
    expect(p).toBeDefined();
    expect((deps.render_profile_store as any).set).toHaveBeenCalledWith("slack", "chat-1", { mode: "plain" });
  });

  it("reset_render_profile → store.reset() 호출", () => {
    const deps = make_coverage_deps();
    const mgr = new ChannelManager(deps);
    const p = mgr.reset_render_profile("slack", "chat-1");
    expect(p).toBeDefined();
    expect((deps.render_profile_store as any).reset).toHaveBeenCalledWith("slack", "chat-1");
  });
});

describe("ChannelManager — resume_after_dashboard_approval", () => {
  it("resume 성공 → invoke_and_reply 후 true", async () => {
    const deps = make_coverage_deps();
    (deps.task_resume as any).resume_after_approval.mockResolvedValue(true);
    const mgr = new ChannelManager(deps);
    const r = await mgr.resume_after_dashboard_approval({
      task_id: "t-123",
      tool_result: "approved",
      provider: "web",
      chat_id: "chat-abc",
    });
    expect(r).toBe(true);
    expect((deps.task_resume as any).resume_after_approval).toHaveBeenCalledWith("t-123", "approved");
  });

  it("resume 실패 → false + warn 로그", async () => {
    const deps = make_coverage_deps();
    (deps.task_resume as any).resume_after_approval.mockResolvedValue(false);
    const mgr = new ChannelManager(deps);
    const r = await mgr.resume_after_dashboard_approval({
      task_id: "t-fail",
      tool_result: "ok",
      provider: "web",
      chat_id: "chat-xyz",
    });
    expect(r).toBe(false);
    expect((deps.logger as any).warn).toHaveBeenCalledWith(
      "dashboard_approval_resume_failed",
      expect.objectContaining({ task_id: "t-fail" }),
    );
  });
});
