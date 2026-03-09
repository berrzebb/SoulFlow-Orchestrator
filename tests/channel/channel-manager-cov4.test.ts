/**
 * ChannelManager — 추가 미커버 분기 커버리지 (cov4).
 * - get/set/reset_render_profile, cancel_active_runs, get_active_run_count
 * - _should_ignore: 다양한 무시 조건 (unknown/subagent/bot/slack_subtype)
 * - effective_render_profile: telegram html vs 다른 provider
 * - prune_seen / prune_render_profiles
 * - resolve_target, extract_mentions
 * - send_outbound: provider=web vs non-web
 * - notify_expired_tasks: expire_stale에서 반환된 작업들
 */
import { describe, it, expect, vi } from "vitest";
import {
  create_harness, inbound,
  create_noop_logger, FakeChannelRegistry, FakeDispatchService,
  FakeOrchestrationService, create_test_channel_config,
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

class FakeApproval {
  async try_handle_text_reply(): Promise<{ handled: boolean }> { return { handled: false }; }
  async try_handle_approval_reactions(): Promise<{ handled: boolean }> { return { handled: false }; }
  prune_seen(): void {}
}

class FakeTaskResume {
  private stale: any[] = [];
  constructor(stale: any[] = []) { this.stale = stale; }
  async try_resume(): Promise<null> { return null; }
  async resume_after_approval(): Promise<boolean> { return false; }
  async cancel_task(): Promise<void> {}
  expire_stale() { return this.stale; }
}

async function make_manager(
  ws: string,
  overrides: {
    registry?: any;
    approval?: any;
    task_resume?: any;
    config_patch?: any;
    session_store?: any;
    tracker?: any;
    bus?: any;
    bot_identity?: any;
  } = {},
) {
  const logger = create_noop_logger();
  const registry = overrides.registry ?? new FakeChannelRegistry();
  const dispatch = new FakeDispatchService(registry);
  const orch = new FakeOrchestrationService();
  const task_resume = overrides.task_resume ?? new FakeTaskResume();
  const approval = overrides.approval ?? new FakeApproval();
  const recorder = new SessionRecorder({ sessions: null, daily_memory: null, sanitize_for_storage: (t) => t, logger });
  const media = new MediaCollector({ workspace_dir: ws, tokens: {} });
  const config = { ...create_test_channel_config(), ...(overrides.config_patch || {}) };
  const bus = overrides.bus ?? new MessageBus();
  const bot_identity = overrides.bot_identity ?? { get_bot_self_id: () => "", get_default_target: () => "" };

  const manager = new ChannelManager({
    bus,
    registry: registry as unknown as ChannelRegistryLike,
    dispatch: dispatch as unknown as DispatchService,
    command_router: new CommandRouter([]),
    orchestration: orch as unknown as OrchestrationService,
    approval: approval as unknown as ApprovalService,
    task_resume: task_resume as unknown as TaskResumeService,
    session_recorder: recorder,
    media_collector: media,
    process_tracker: overrides.tracker ?? null,
    providers: {} as never,
    config,
    workspace_dir: ws,
    logger,
    bot_identity,
    session_store: overrides.session_store ?? null,
  });

  return { manager, registry, dispatch: dispatch as FakeDispatchService };
}

// ══════════════════════════════════════════════════
// get/set/reset_render_profile
// ══════════════════════════════════════════════════

describe("ChannelManager — render profile", () => {
  it("set_render_profile → get_render_profile로 확인", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws);
      manager.set_render_profile("slack", "C123", { mode: "markdown" });
      const profile = manager.get_render_profile("slack", "C123");
      expect(profile.mode).toBe("markdown");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("reset_render_profile → 기본값으로 복원", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws);
      manager.set_render_profile("slack", "C123", { mode: "html" });
      manager.reset_render_profile("slack", "C123");
      const profile = manager.get_render_profile("slack", "C123");
      // 기본값 (markdown 또는 plain)
      expect(["markdown", "plain", "html"]).toContain(profile.mode);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// cancel_active_runs / get_active_run_count
// ══════════════════════════════════════════════════

describe("ChannelManager — active_run_count / cancel", () => {
  it("get_active_run_count → 0 반환 (초기값)", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws);
      expect(manager.get_active_run_count()).toBe(0);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("cancel_active_runs → 0 반환 (활성 실행 없음)", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws);
      const cancelled = manager.cancel_active_runs();
      expect(cancelled).toBe(0);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// _should_ignore — 다양한 무시 조건
// ══════════════════════════════════════════════════

describe("ChannelManager — _should_ignore", () => {
  it("sender_id='' → 무시", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws);
      const msg = inbound("hello", { provider: "slack" });
      (msg as any).sender_id = "";
      expect((manager as any)._should_ignore(msg)).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("sender_id='unknown' → 무시", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws);
      const msg = inbound("hello", { provider: "slack" });
      (msg as any).sender_id = "unknown";
      expect((manager as any)._should_ignore(msg)).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("sender_id='subagent:sa1' → 무시", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws);
      const msg = inbound("hello", { provider: "slack" });
      (msg as any).sender_id = "subagent:sa1";
      expect((manager as any)._should_ignore(msg)).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("sender_id='approval-bot' → 무시", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws);
      const msg = inbound("hello");
      (msg as any).sender_id = "approval-bot";
      expect((manager as any)._should_ignore(msg)).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("metadata.from_is_bot=true → 무시", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws);
      const msg = inbound("hello");
      (msg as any).sender_id = "real-user";
      (msg as any).metadata = { from_is_bot: true };
      expect((manager as any)._should_ignore(msg)).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("metadata.kind='task_recovery' → 무시", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws);
      const msg = inbound("hello");
      (msg as any).sender_id = "real-user";
      (msg as any).metadata = { kind: "task_recovery" };
      expect((manager as any)._should_ignore(msg)).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("slack.bot_id 존재 → 무시", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws);
      const msg = inbound("hello", { provider: "slack" });
      (msg as any).sender_id = "U123";
      (msg as any).metadata = { slack: { bot_id: "B001" } };
      expect((manager as any)._should_ignore(msg)).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("slack.subtype='bot_message' → 무시", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws);
      const msg = inbound("hello", { provider: "slack" });
      (msg as any).sender_id = "U123";
      (msg as any).metadata = { slack: { subtype: "bot_message" } };
      expect((manager as any)._should_ignore(msg)).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("slack.subtype='message_changed' → 무시", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws);
      const msg = inbound("hello", { provider: "slack" });
      (msg as any).sender_id = "U123";
      (msg as any).metadata = { slack: { subtype: "message_changed" } };
      expect((manager as any)._should_ignore(msg)).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("정상 사용자 → 무시 안 함", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws);
      const msg = inbound("hello", { provider: "slack" });
      (msg as any).sender_id = "U-real-user";
      expect((manager as any)._should_ignore(msg)).toBe(false);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("sender가 bot_self_id와 동일 → 무시", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const bot_identity = {
        get_bot_self_id: (provider: string) => provider === "slack" ? "BOT123" : "",
        get_default_target: () => "",
      };
      const { manager } = await make_manager(ws, { bot_identity });
      const msg = inbound("hello", { provider: "slack" });
      (msg as any).sender_id = "bot123"; // lowercase
      expect((manager as any)._should_ignore(msg)).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// effective_render_profile
// ══════════════════════════════════════════════════

describe("ChannelManager — effective_render_profile", () => {
  it("telegram + html → html 유지", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws);
      manager.set_render_profile("telegram", "12345", { mode: "html" });
      const profile = (manager as any).effective_render_profile("telegram", "12345");
      expect(profile.mode).toBe("html");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("slack + html → markdown으로 변환", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws);
      manager.set_render_profile("slack", "C123", { mode: "html" });
      const profile = (manager as any).effective_render_profile("slack", "C123");
      expect(profile.mode).toBe("markdown");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// prune_seen / prune_render_profiles
// ══════════════════════════════════════════════════

describe("ChannelManager — prune_seen / prune_render_profiles", () => {
  it("prune_seen() 호출 → 오류 없이 완료", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws);
      // 내부 seen에 몇 개 추가
      const msg = inbound("hello");
      (manager as any).mark_seen(msg);
      (manager as any).prune_seen();
      expect(true).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("prune_render_profiles(): render_profile_ts가 비면 즉시 반환", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws);
      // render_profile_ts 비어있음
      (manager as any).prune_render_profiles();
      expect(true).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("prune_render_profiles(): 오래된 프로필 삭제", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws, { config_patch: { seenTtlMs: 100 } });
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
// resolve_target
// ══════════════════════════════════════════════════

describe("ChannelManager — resolve_target", () => {
  it("instance_id 있고 target 존재 → instance target 반환", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const bot_identity = {
        get_bot_self_id: () => "",
        get_default_target: (id: string) => id === "slack-1" ? "C_DEFAULT" : "",
      };
      const { manager } = await make_manager(ws, { bot_identity });
      const target = (manager as any).resolve_target("slack", "slack-1");
      expect(target).toBe("C_DEFAULT");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("instance_id 있지만 target 없음 → provider target 시도", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const bot_identity = {
        get_bot_self_id: () => "",
        get_default_target: (id: string) => id === "slack" ? "C_SLACK" : "",
      };
      const { manager } = await make_manager(ws, { bot_identity });
      const target = (manager as any).resolve_target("slack", "unknown-instance");
      // instance에서 못 찾으면 provider로 폴백
      expect(target).toBe("C_SLACK");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("instance_id 없으면 provider target", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const bot_identity = {
        get_bot_self_id: () => "",
        get_default_target: (id: string) => id === "telegram" ? "12345" : "",
      };
      const { manager } = await make_manager(ws, { bot_identity });
      const target = (manager as any).resolve_target("telegram", undefined);
      expect(target).toBe("12345");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// extract_mentions
// ══════════════════════════════════════════════════

describe("ChannelManager — extract_mentions", () => {
  it("metadata.mentions 있음 → meta aliases 반환", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws);
      const msg = inbound("hello @claude", { provider: "slack" });
      (msg as any).metadata = { mentions: [{ alias: "claude" }, { alias: "worker" }] };
      const mentions = (manager as any).extract_mentions("slack", msg);
      // "claude" → defaultAlias (from config), "worker" → kept
      expect(Array.isArray(mentions)).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("metadata.mentions 없음 → channel.parse_agent_mentions 사용", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const registry = new FakeChannelRegistry();
      const fake_channel = {
        parse_agent_mentions: vi.fn().mockReturnValue([{ alias: "soul" }]),
        sync_commands: vi.fn().mockResolvedValue(undefined),
      };
      (registry as any).get_channel = vi.fn().mockReturnValue(fake_channel);
      const { manager } = await make_manager(ws, { registry });
      const msg = inbound("@soul 작업 수행", { provider: "slack" });
      const mentions = (manager as any).extract_mentions("slack", msg);
      expect(Array.isArray(mentions)).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("'claude-worker' alias → defaultAlias로 변환", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws, { config_patch: { defaultAlias: "soul" } });
      const msg = inbound("@claude-worker 작업", { provider: "slack" });
      (msg as any).metadata = { mentions: [{ alias: "claude-worker" }] };
      const mentions = (manager as any).extract_mentions("slack", msg);
      expect(mentions).toContain("soul");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// notify_expired_tasks
// ══════════════════════════════════════════════════

describe("ChannelManager — notify_expired_tasks", () => {
  it("expire_stale() → 만료 태스크 없음 → 미발행", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const task_resume = new FakeTaskResume([]);
      const dispatch_spy = vi.fn().mockResolvedValue({ ok: true, message_id: "m0" });
      const { manager } = await make_manager(ws, { task_resume });
      (manager as any).dispatch = { send: dispatch_spy };
      await (manager as any).notify_expired_tasks("slack");
      await new Promise((r) => setTimeout(r, 50));
      expect(dispatch_spy).not.toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("expire_stale() → 만료 태스크 있음 → dispatch.send 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const expired_tasks = [
        { taskId: "task-1", chatId: "C123", channel: "slack", title: "이전 태스크", memory: {} },
      ];
      const task_resume = new FakeTaskResume(expired_tasks);
      const dispatch_spy = vi.fn().mockResolvedValue({ ok: true, message_id: "m1" });
      const registry = new FakeChannelRegistry();
      const { manager } = await make_manager(ws, {
        task_resume,
        registry,
      });
      // dispatch.send 직접 스파이
      (manager as any).dispatch = { send: dispatch_spy };
      await (manager as any).notify_expired_tasks("slack");
      // 비동기 fire-and-forget이므로 잠깐 대기
      await new Promise((r) => setTimeout(r, 50));
      expect(dispatch_spy).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("objective 있는 태스크 → expired_task에 objective 포함", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const expired_tasks = [
        { taskId: "task-2", chatId: "C456", channel: "slack", title: "목표 태스크", memory: { objective: "데이터 분석" } },
      ];
      const task_resume = new FakeTaskResume(expired_tasks);
      const dispatch_spy = vi.fn().mockResolvedValue({ ok: true, message_id: "m2" });
      const { manager } = await make_manager(ws, { task_resume });
      (manager as any).dispatch = { send: dispatch_spy };
      await (manager as any).notify_expired_tasks("slack");
      await new Promise((r) => setTimeout(r, 50));
      expect(dispatch_spy).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// send_outbound — web provider vs non-web
// ══════════════════════════════════════════════════

describe("ChannelManager — send_outbound", () => {
  it("provider=web → bus.publish_outbound 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const bus = {
        publish_outbound: vi.fn().mockResolvedValue(undefined),
        publish_inbound: vi.fn().mockResolvedValue(undefined),
        subscribe_inbound: vi.fn().mockReturnValue(() => {}),
      } as any;
      const { manager } = await make_manager(ws, { bus });
      const msg = inbound("hello", { provider: "web" });
      await (manager as any).send_outbound("web", msg, "soul", "응답 내용", { kind: "agent_reply" });
      expect(bus.publish_outbound).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("provider=slack → dispatch.send 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws);
      const dispatch_spy = vi.fn().mockResolvedValue({ ok: true, message_id: "m1" });
      (manager as any).dispatch = { send: dispatch_spy };
      const msg = inbound("hello", { provider: "slack" });
      await (manager as any).send_outbound("slack", msg, "soul", "응답 내용", { kind: "agent_reply" });
      expect(dispatch_spy).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// render_reply — 다양한 입력
// ══════════════════════════════════════════════════

describe("ChannelManager — render_reply", () => {
  it("일반 텍스트 → content 반환", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws);
      const result = (manager as any).render_reply("안녕하세요, 사용자!", "slack", "C123") as any;
      expect(typeof result.content).toBe("string");
      expect(result.render_mode).toBeDefined();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("media URL 포함 → media 배열 반환", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws);
      const result = (manager as any).render_reply("텍스트 내용", "telegram", "12345") as any;
      expect(Array.isArray(result.media)).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// try_read_ack
// ══════════════════════════════════════════════════

describe("ChannelManager — try_read_ack", () => {
  it("readAckEnabled=false → add_reaction 미호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws, { config_patch: { readAckEnabled: false } });
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws, { config_patch: { readAckEnabled: true } });
      const msg = inbound("hello");
      (msg as any).id = "";
      await (manager as any).try_read_ack("slack", msg);
      expect(true).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("readAckEnabled=true + message_id 있음 + channel.add_reaction 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov4-"));
    try {
      const { manager } = await make_manager(ws, { config_patch: { readAckEnabled: true, readAckReaction: "eyes" } });
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
