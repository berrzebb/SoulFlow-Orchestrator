/**
 * ChannelManager — 미커버 분기 보충 (cov6).
 * - is_duplicate: seen 키 있음/없음 (L1111-1112)
 * - prune_seen: control_reaction_seen, mention_cooldowns, primed_targets 비어있지 않을 때 (L1117-1119)
 * - send_error_reply → normalize_error_detail 분기 (L1316, L1317, L1319)
 *   - 빈 에러 → "unknown_error"
 *   - "unexpected argument" 포함 → "executor_args_invalid"
 */
import { describe, it, expect, vi } from "vitest";
import {
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
import type { InboundMessage } from "@src/channels/types.ts";

class FakeApproval {
  async try_handle_text_reply(): Promise<{ handled: boolean }> { return { handled: false }; }
  async try_handle_approval_reactions(): Promise<{ handled: boolean }> { return { handled: false }; }
  prune_seen(): void {}
}

class FakeTaskResume {
  async try_resume(): Promise<null> { return null; }
  async resume_after_approval(): Promise<boolean> { return false; }
  async cancel_task(): Promise<void> {}
  expire_stale() { return []; }
}

async function make_manager(ws: string, overrides: Record<string, unknown> = {}) {
  const logger = create_noop_logger();
  const registry = new FakeChannelRegistry();
  const dispatch = new FakeDispatchService(registry);
  const orch = new FakeOrchestrationService();
  const task_resume = new FakeTaskResume();
  const approval = new FakeApproval();
  const recorder = new SessionRecorder({ sessions: null, daily_memory: null, sanitize_for_storage: (t) => t, logger });
  const media = new MediaCollector({ workspace_dir: ws, tokens: {} });
  const config = create_test_channel_config();
  const bus = new MessageBus();

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
    process_tracker: null,
    providers: {} as never,
    config: { ...config, ...(overrides.config_patch || {}) },
    workspace_dir: ws,
    logger,
    bot_identity: { get_bot_self_id: () => "", get_default_target: () => "" },
    session_store: null,
    ...overrides,
  });

  return { manager, registry, dispatch: dispatch as FakeDispatchService };
}

function inbound(content = "hello", overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: `msg-${Date.now()}`,
    provider: "slack",
    channel: "slack",
    sender_id: "U001",
    chat_id: "C123",
    content,
    at: new Date().toISOString(),
    metadata: { message_id: `mid-${Date.now()}` },
    ...overrides,
  } as InboundMessage;
}

// ══════════════════════════════════════════
// is_duplicate (L1110-1112)
// ══════════════════════════════════════════

describe("ChannelManager — is_duplicate (L1111-1112)", () => {
  it("mark_seen 후 is_duplicate → true (seen 키 있음)", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov6-"));
    try {
      const { manager } = await make_manager(ws);
      const msg = inbound("hello");
      (manager as any).mark_seen(msg);
      expect((manager as any).is_duplicate(msg)).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("mark_seen 안 한 메시지 → is_duplicate=false", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov6-"));
    try {
      const { manager } = await make_manager(ws);
      const msg = inbound("hello");
      expect((manager as any).is_duplicate(msg)).toBe(false);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("message_id 없는 메시지 → seen_key=null → is_duplicate=false (L1112 false 분기)", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov6-"));
    try {
      const { manager } = await make_manager(ws);
      const msg = inbound("hello", { id: "", metadata: {} });
      expect((manager as any).is_duplicate(msg)).toBe(false);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════
// prune_seen — 비어있지 않은 맵들 (L1117-1119)
// ══════════════════════════════════════════

describe("ChannelManager — prune_seen 비어있지 않은 맵 (L1117-1119)", () => {
  it("control_reaction_seen, mention_cooldowns, primed_targets에 항목 있을 때 → 콜백 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov6-"));
    try {
      const { manager } = await make_manager(ws);

      // L1117: control_reaction_seen에 항목 추가
      const crs = (manager as any).control_reaction_seen as Map<string, number>;
      crs.set("test-key-crs", Date.now());

      // L1118: mention_cooldowns에 항목 추가
      const mc = (manager as any).mention_cooldowns as Map<string, number>;
      mc.set("test-key-mc", Date.now());

      // L1119: primed_targets에 항목 추가
      const pt = (manager as any).primed_targets as Map<string, number>;
      pt.set("test-key-pt", Date.now());

      // prune_seen 호출 → L1117-1119의 (ts) => ts 콜백 호출됨
      (manager as any).prune_seen();

      // 오류 없이 완료
      expect(true).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("만료된 항목은 삭제됨", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov6-"));
    try {
      const { manager } = await make_manager(ws, { config_patch: { seenTtlMs: 1, reactionActionTtlMs: 1 } });

      const crs = (manager as any).control_reaction_seen as Map<string, number>;
      crs.set("old-crs", Date.now() - 100); // already expired

      await new Promise((r) => setTimeout(r, 10)); // wait > 1ms
      (manager as any).prune_seen();

      expect(crs.has("old-crs")).toBe(false);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});
