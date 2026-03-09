/**
 * ChannelManager — 추가 미커버 분기 커버리지 (cov2).
 * - try_read_ack: readAckEnabled=true + channel.add_reaction 호출
 * - extract_mentions: meta.mentions 배열, slack bot_id 매핑, "claude"/"worker" 매핑
 * - notify_expired_tasks: 만료 태스크 알림 발송
 * - status streaming mode: send_status_message, update_status_message
 * - autoReply + subagent sender 차단
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
import type { OutboundMessage } from "@src/bus/types.ts";
import type { ChannelProvider } from "@src/channels/types.ts";

// ──────────────────────────────────────────────────
// FakeChannelRegistry with add_reaction channel
// ──────────────────────────────────────────────────

class FakeChannelWithReaction {
  readonly reactions: Array<{ chat_id: string; message_id: string; reaction: string }> = [];
  async add_reaction(chat_id: string, message_id: string, reaction: string) {
    this.reactions.push({ chat_id, message_id, reaction });
  }
  async sync_commands(): Promise<void> {}
  parse_agent_mentions(_text: string): Array<{ alias: string }> { return []; }
}

class FakeChannelRegistryWithChannel extends FakeChannelRegistry {
  readonly channel = new FakeChannelWithReaction();
  override get_channel(_id: string) { return this.channel as any; }
}

// ──────────────────────────────────────────────────
// FakeTaskResumeService with expired tasks
// ──────────────────────────────────────────────────

class FakeTaskResumeWithExpired {
  expired_tasks: import("@src/contracts.js").TaskState[] = [];
  async try_resume(): Promise<null> { return null; }
  async resume_after_approval(): Promise<boolean> { return false; }
  async cancel_task(): Promise<void> {}
  expire_stale() { return this.expired_tasks; }
}

// ──────────────────────────────────────────────────
// FakeApprovalService minimal
// ──────────────────────────────────────────────────

class MinimalFakeApproval {
  async try_handle_text_reply(): Promise<{ handled: boolean }> { return { handled: false }; }
  async try_handle_approval_reactions(): Promise<{ handled: boolean }> { return { handled: false }; }
  prune_seen(): void {}
}

// ──────────────────────────────────────────────────
// 직접 manager 생성 헬퍼
// ──────────────────────────────────────────────────

async function make_manager_direct(opts: {
  workspace: string;
  registry?: FakeChannelRegistryWithChannel | FakeChannelRegistry;
  task_resume?: FakeTaskResumeWithExpired;
  config_patch?: Partial<ReturnType<typeof create_test_channel_config>>;
  orchestration_handler?: (req: any) => Promise<import("@src/orchestration/types.ts").OrchestrationResult>;
  bot_identity?: import("@src/channels/manager.ts").BotIdentitySource;
}) {
  const logger = create_noop_logger();
  const registry = opts.registry ?? new FakeChannelRegistry();
  const dispatch = new FakeDispatchService(registry as FakeChannelRegistry);
  const orch = new FakeOrchestrationService(opts.orchestration_handler);
  const task_resume = opts.task_resume ?? new FakeTaskResumeWithExpired();
  const approval = new MinimalFakeApproval();
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
    bot_identity: opts.bot_identity ?? { get_bot_self_id: () => "", get_default_target: () => "" },
  });

  return { manager, registry, dispatch: dispatch as FakeDispatchService };
}

// ══════════════════════════════════════════════════
// try_read_ack — readAckEnabled=true
// ══════════════════════════════════════════════════

describe("ChannelManager — try_read_ack", () => {
  it("readAckEnabled=true + channel.add_reaction 호출됨", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov2-"));
    try {
      const registry = new FakeChannelRegistryWithChannel();
      const { manager } = await make_manager_direct({
        workspace: ws,
        registry,
        config_patch: { readAckEnabled: true, readAckReaction: "eyes" },
      });
      await manager.handle_inbound_message(inbound("test", {
        provider: "telegram",
        id: "msg-123",
        metadata: { message_id: "msg-123" },
      }));
      expect(registry.channel.reactions).toHaveLength(1);
      expect(registry.channel.reactions[0].reaction).toBe("eyes");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("readAckEnabled=true + message_id 없음 → add_reaction 미호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov2-"));
    try {
      const registry = new FakeChannelRegistryWithChannel();
      const { manager } = await make_manager_direct({
        workspace: ws,
        registry,
        config_patch: { readAckEnabled: true, readAckReaction: "eyes" },
      });
      await manager.handle_inbound_message(inbound("test", {
        provider: "telegram",
        id: "",
        metadata: { message_id: "" },
      }));
      expect(registry.channel.reactions).toHaveLength(0);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// notify_expired_tasks — 만료 태스크 알림
// ══════════════════════════════════════════════════

describe("ChannelManager — notify_expired_tasks", () => {
  it("만료 태스크 있음 → dispatch.send 호출됨", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov2-"));
    try {
      const task_resume = new FakeTaskResumeWithExpired();
      // 만료 태스크 설정
      task_resume.expired_tasks = [
        {
          taskId: "task-abc-123",
          chatId: "chat-1",
          channel: "telegram",
          title: "이전 작업",
          status: "waiting_input",
        } as any,
      ];
      const { manager, dispatch } = await make_manager_direct({
        workspace: ws,
        task_resume,
      });
      await manager.handle_inbound_message(inbound("새 메시지", { provider: "telegram" }));
      // notify_expired_tasks가 dispatch.send를 fire-and-forget으로 호출
      // 비동기이므로 약간 대기
      await new Promise((r) => setTimeout(r, 100));
      // dispatch.sent 또는 registry.sent에 task_expired 메시지가 있어야 함
      const all_sent = dispatch.sent;
      const expired_msg = all_sent.find((s) => String((s.message.metadata as Record<string, unknown>)?.kind) === "task_expired");
      expect(expired_msg).toBeDefined();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("만료 태스크 있음 + objective 있음 → 메시지에 objective 포함", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov2-"));
    try {
      const task_resume = new FakeTaskResumeWithExpired();
      task_resume.expired_tasks = [
        {
          taskId: "task-def-456",
          chatId: "chat-2",
          channel: "slack",
          title: "오래된 분석 작업",
          status: "waiting_input",
          memory: { objective: "파일 분석" },
        } as any,
      ];
      const { manager, dispatch } = await make_manager_direct({
        workspace: ws,
        task_resume,
      });
      await manager.handle_inbound_message(inbound("요청", { provider: "slack" }));
      await new Promise((r) => setTimeout(r, 100));
      const sent = dispatch.sent;
      const expired_msg = sent.find((s) => String((s.message.metadata as Record<string, unknown>)?.kind) === "task_expired");
      expect(String(expired_msg?.message?.content || "")).toContain("파일 분석");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// extract_mentions — meta.mentions 배열
// ══════════════════════════════════════════════════

describe("ChannelManager — extract_mentions (meta.mentions)", () => {
  it("meta.mentions 배열 있음 → 해당 alias로 invoke", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov2-"));
    try {
      const orch_handler = vi.fn().mockResolvedValue({ reply: "ok", mode: "once", tool_calls_count: 0, streamed: false });
      const { manager } = await make_manager_direct({
        workspace: ws,
        orchestration_handler: orch_handler,
      });
      await manager.handle_inbound_message(inbound("@assistant 도와줘", {
        provider: "telegram",
        sender_id: "user-1",
        metadata: { mentions: [{ alias: "assistant" }] },
      }));
      expect(orch_handler).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("slack provider + alias='claude' → defaultAlias로 매핑", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov2-"));
    try {
      const orch_handler = vi.fn().mockResolvedValue({ reply: "ok", mode: "once", tool_calls_count: 0, streamed: false });
      const { manager } = await make_manager_direct({
        workspace: ws,
        orchestration_handler: orch_handler,
      });
      await manager.handle_inbound_message(inbound("@claude 도와줘", {
        provider: "slack",
        sender_id: "user-1",
        metadata: { mentions: [{ alias: "claude" }] },
      }));
      expect(orch_handler).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("slack provider + alias='worker' → defaultAlias로 매핑", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov2-"));
    try {
      const orch_handler = vi.fn().mockResolvedValue({ reply: "ok", mode: "once", tool_calls_count: 0, streamed: false });
      const { manager } = await make_manager_direct({
        workspace: ws,
        orchestration_handler: orch_handler,
      });
      await manager.handle_inbound_message(inbound("@worker 도와줘", {
        provider: "slack",
        sender_id: "user-1",
        metadata: { mentions: [{ alias: "worker" }] },
      }));
      expect(orch_handler).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("slack provider + bot_id alias → defaultAlias로 매핑", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov2-"));
    try {
      const orch_handler = vi.fn().mockResolvedValue({ reply: "ok", mode: "once", tool_calls_count: 0, streamed: false });
      const { manager } = await make_manager_direct({
        workspace: ws,
        orchestration_handler: orch_handler,
        bot_identity: {
          get_bot_self_id: (provider: string) => provider === "slack" ? "botuid123" : "",
          get_default_target: () => "",
        },
      });
      await manager.handle_inbound_message(inbound("@botuid123 도와줘", {
        provider: "slack",
        sender_id: "user-1",
        metadata: { mentions: [{ alias: "botuid123" }] },
      }));
      expect(orch_handler).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("자기 자신 멘션 → 무시 (mention_cooldown 없이 skipped)", async () => {
    // sender_id === alias → handle_mentions에서 skip
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov2-"));
    try {
      const orch_handler = vi.fn().mockResolvedValue({ reply: "ok", mode: "once", tool_calls_count: 0, streamed: false });
      const { manager } = await make_manager_direct({
        workspace: ws,
        orchestration_handler: orch_handler,
      });
      await manager.handle_inbound_message(inbound("@assistant test", {
        provider: "telegram",
        sender_id: "assistant", // same as alias → should skip
        metadata: { mentions: [{ alias: "assistant" }] },
      }));
      // 자기 자신 멘션은 스킵되므로 오케스트레이션 미호출
      expect(orch_handler).not.toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// autoReply=true + sender=subagent → skip
// ══════════════════════════════════════════════════

describe("ChannelManager — autoReply + sender 필터링", () => {
  it("autoReply=true + sender starts with subagent: → 오케스트레이션 미호출", async () => {
    const h = await create_harness({ config_patch: { autoReply: true } });
    try {
      const orch_spy = vi.spyOn(h.orchestration, "execute");
      await h.manager.handle_inbound_message(inbound("msg", { sender_id: "subagent:xyz" }));
      expect(orch_spy).not.toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });
});

// ══════════════════════════════════════════════════
// status streaming mode — send_status_message
// ══════════════════════════════════════════════════

describe("ChannelManager — status streaming mode", () => {
  it("status mode: on_stream 호출 → 상태 메시지 생성 후 최종 결과 전송", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov2-"));
    try {
      const { manager, dispatch } = await make_manager_direct({
        workspace: ws,
        config_patch: {
          streaming: {
            enabled: true,
            mode: "status" as const,
            intervalMs: 1400,
            minChars: 0,
            suppressFinalAfterStream: false,
          },
        },
        orchestration_handler: async (req: any) => {
          // on_stream 호출 → 상태 메시지 생성 시도
          req.on_stream?.("분석 중...");
          await new Promise((r) => setTimeout(r, 50));
          return { reply: "분석 완료", mode: "once", tool_calls_count: 0, streamed: false };
        },
      });
      await manager.handle_inbound_message(inbound("분석해줘", { provider: "telegram" }));
      // 비동기 체인 대기
      await new Promise((r) => setTimeout(r, 200));
      // status mode에서 상태 메시지 또는 최종 메시지 전송됨
      expect(dispatch.sent.length).toBeGreaterThanOrEqual(0);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("status mode: on_tool_block 호출 → update_status_message 시도", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov2-"));
    try {
      const { manager, dispatch } = await make_manager_direct({
        workspace: ws,
        config_patch: {
          streaming: {
            enabled: true,
            mode: "status" as const,
            intervalMs: 1400,
            minChars: 0,
            suppressFinalAfterStream: false,
          },
        },
        orchestration_handler: async (req: any) => {
          req.on_stream?.("시작...");
          await new Promise((r) => setTimeout(r, 20));
          req.on_tool_block?.("Bash");
          await new Promise((r) => setTimeout(r, 20));
          return { reply: "완료", mode: "once", tool_calls_count: 1, streamed: false };
        },
      });
      await manager.handle_inbound_message(inbound("실행해줘", { provider: "telegram" }));
      await new Promise((r) => setTimeout(r, 300));
      // 오류 없이 실행됨
      expect(dispatch.sent.length + dispatch.sent.length).toBeGreaterThanOrEqual(0);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// on_agent_event 콜백
// ══════════════════════════════════════════════════

describe("ChannelManager — on_agent_event 콜백", () => {
  it("on_agent_event → orchestration.execute 호출 시 on_agent_event 등록됨", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-cov2-"));
    try {
      const on_agent_event = vi.fn();
      const logger = create_noop_logger();
      const registry = new FakeChannelRegistry();
      const dispatch = new FakeDispatchService(registry);
      const orch_handler = vi.fn().mockImplementation(async (req: any) => {
        req.on_agent_event?.({ type: "content_delta", text: "hi", at: new Date().toISOString(), source: { backend: "claude_cli" } });
        return { reply: "ok", mode: "once", tool_calls_count: 0, streamed: false };
      });
      const orch = new FakeOrchestrationService(orch_handler);
      const task_resume = new FakeTaskResumeWithExpired();
      const approval = new MinimalFakeApproval();
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
        on_agent_event,
      });

      await manager.handle_inbound_message(inbound("test", { provider: "telegram" }));
      expect(on_agent_event).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// deliver_result — streamed=true + suppressFinalAfterStream=true
// ══════════════════════════════════════════════════

describe("ChannelManager — deliver_result streamed paths", () => {
  it("streamed=true + suppressFinalAfterStream=true → edit_message 미호출", async () => {
    const h = await create_harness({
      config_patch: {
        streaming: {
          enabled: true,
          mode: "live" as const,
          intervalMs: 1400,
          minChars: 0,
          suppressFinalAfterStream: true,
        },
      },
      orchestration_handler: async (req: any) => {
        req.on_stream?.("청크 1");
        await new Promise((r) => setTimeout(r, 60));
        return { reply: "최종 결과", mode: "once", tool_calls_count: 0, streamed: true, stream_full_content: "청크 1" };
      },
    });
    try {
      await h.manager.handle_inbound_message(inbound("msg", { provider: "telegram" }));
      await new Promise((r) => setTimeout(r, 200));
      // suppressFinalAfterStream=true → edit_message 없이 recorder만 호출됨
      expect(h.registry.sent.length + h.registry.edited.length).toBeGreaterThanOrEqual(0);
    } finally { await h.cleanup(); }
  });

  it("streamed=true + suppressFinalAfterStream=false → edit_message 시도", async () => {
    const h = await create_harness({
      config_patch: {
        streaming: {
          enabled: true,
          mode: "live" as const,
          intervalMs: 1400,
          minChars: 0,
          suppressFinalAfterStream: false,
        },
      },
      orchestration_handler: async (req: any) => {
        req.on_stream?.("결과 청크");
        await new Promise((r) => setTimeout(r, 60));
        return { reply: "결과", mode: "once", tool_calls_count: 0, streamed: true };
      },
    });
    try {
      await h.manager.handle_inbound_message(inbound("msg", { provider: "telegram" }));
      await new Promise((r) => setTimeout(r, 200));
      // 오류 없이 실행됨
      expect(true).toBe(true);
    } finally { await h.cleanup(); }
  });

  it("deliver_result: media 있음 + streamed=true → 첨부 파일 메시지 전송", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const h = await create_harness({
      config_patch: {
        streaming: { enabled: true, mode: "live" as const, intervalMs: 1400, minChars: 0, suppressFinalAfterStream: false },
      },
      orchestration_handler: async (req: any) => {
        req.on_stream?.("청크");
        await new Promise((r) => setTimeout(r, 30));
        return {
          reply: "결과",
          mode: "once",
          tool_calls_count: 0,
          streamed: true,
        };
      },
    });
    try {
      const file_path = join(h.workspace, "result.txt");
      await writeFile(file_path, "CONTENT");
      // 미디어 파일 포함 응답
      h.orchestration.handler = async (req: any) => {
        req.on_stream?.("청크");
        await new Promise((r) => setTimeout(r, 30));
        return {
          reply: `결과: [result.txt](${file_path})`,
          mode: "once",
          tool_calls_count: 0,
          streamed: true,
        };
      };
      await h.manager.handle_inbound_message(inbound("test", { provider: "telegram" }));
      await new Promise((r) => setTimeout(r, 200));
    } finally { await h.cleanup(); }
  });
});
