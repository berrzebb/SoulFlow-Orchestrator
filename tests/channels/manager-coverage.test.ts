/**
 * ChannelManager — 공개 메서드 커버리지.
 * start/stop 루프 없이 mock 기반으로 동기 메서드와 간단한 비동기 경로 검증.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChannelManager } from "@src/channels/manager.js";
import type { ChannelManagerDeps } from "@src/channels/manager.js";

// ── mock factory ──────────────────────────────────────────────────

function make_deps(overrides: Partial<ChannelManagerDeps> = {}): ChannelManagerDeps {
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
  return new ChannelManager(make_deps(overrides));
}

// ══════════════════════════════════════════
// set_workflow_hitl
// ══════════════════════════════════════════

describe("ChannelManager — set_workflow_hitl", () => {
  it("브리지 설정 후 내부 workflow_hitl에 반영됨", () => {
    const mgr = make_manager();
    const bridge = { try_resolve: vi.fn().mockResolvedValue(true) };
    // 예외 없이 설정 가능
    expect(() => mgr.set_workflow_hitl(bridge)).not.toThrow();
  });
});

// ══════════════════════════════════════════
// health_check
// ══════════════════════════════════════════

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

// ══════════════════════════════════════════
// get_status
// ══════════════════════════════════════════

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

// ══════════════════════════════════════════
// get_channel_health
// ══════════════════════════════════════════

describe("ChannelManager — get_channel_health", () => {
  it("registry.get_health() 결과 반환", () => {
    const deps = make_deps();
    const mgr = new ChannelManager(deps);
    const health = mgr.get_channel_health();
    expect(health).toEqual([{ instance_id: "slack-1", ok: true }]);
    expect((deps.registry as any).get_health).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════
// get_active_run_count / cancel_active_runs
// ══════════════════════════════════════════

describe("ChannelManager — active_runs 위임", () => {
  it("get_active_run_count → active_run_controller.size 반환", () => {
    const deps = make_deps();
    (deps.active_run_controller as any).size = 3;
    const mgr = new ChannelManager(deps);
    expect(mgr.get_active_run_count()).toBe(3);
  });

  it("cancel_active_runs() → active_run_controller.cancel() 호출", () => {
    const deps = make_deps();
    (deps.active_run_controller as any).cancel.mockReturnValue(2);
    const mgr = new ChannelManager(deps);
    const n = mgr.cancel_active_runs();
    expect(n).toBe(2);
    expect((deps.active_run_controller as any).cancel).toHaveBeenCalledWith(undefined);
  });

  it("cancel_active_runs(key) → key 전달", () => {
    const deps = make_deps();
    (deps.active_run_controller as any).cancel.mockReturnValue(1);
    const mgr = new ChannelManager(deps);
    mgr.cancel_active_runs("some-key");
    expect((deps.active_run_controller as any).cancel).toHaveBeenCalledWith("some-key");
  });
});

// ══════════════════════════════════════════
// get_render_profile / set_render_profile / reset_render_profile
// ══════════════════════════════════════════

describe("ChannelManager — render profile 위임", () => {
  it("get_render_profile → store.get() 호출", () => {
    const deps = make_deps();
    const mgr = new ChannelManager(deps);
    const p = mgr.get_render_profile("slack", "chat-1");
    expect(p).toBeDefined();
    expect((deps.render_profile_store as any).get).toHaveBeenCalledWith("slack", "chat-1");
  });

  it("set_render_profile → store.set() 호출 후 프로필 반환", () => {
    const deps = make_deps();
    const mgr = new ChannelManager(deps);
    const p = mgr.set_render_profile("slack", "chat-1", { mode: "plain" as any });
    expect(p).toBeDefined();
    expect((deps.render_profile_store as any).set).toHaveBeenCalledWith("slack", "chat-1", { mode: "plain" });
  });

  it("reset_render_profile → store.reset() 호출", () => {
    const deps = make_deps();
    const mgr = new ChannelManager(deps);
    const p = mgr.reset_render_profile("slack", "chat-1");
    expect(p).toBeDefined();
    expect((deps.render_profile_store as any).reset).toHaveBeenCalledWith("slack", "chat-1");
  });
});

// ══════════════════════════════════════════
// resume_after_dashboard_approval
// ══════════════════════════════════════════

describe("ChannelManager — resume_after_dashboard_approval", () => {
  it("resume 성공 → invoke_and_reply 후 true", async () => {
    const deps = make_deps();
    (deps.task_resume as any).resume_after_approval.mockResolvedValue(true);
    // orchestration.execute mock이 있으므로 실제 호출 가능
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
    const deps = make_deps();
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
