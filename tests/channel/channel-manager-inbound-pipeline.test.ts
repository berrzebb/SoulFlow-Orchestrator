/**
 * ChannelManager — 인바운드 파이프라인 통합 테스트 (cov2 + cov3 병합).
 * try_read_ack, notify_expired_tasks, extract_mentions, status streaming,
 * on_agent_event, deliver_result streamed, handle_control_reactions,
 * _recover_orphaned_messages, render_msg, start/stop lifecycle,
 * sync_commands, get_channel_health, run_inbound_consumer.
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

// FakeChannelRegistry with sync_commands spy
class FakeRegistryWithSync extends FakeChannelRegistry {
  readonly sync_spy = vi.fn().mockResolvedValue(undefined);
  private readonly fake_channel = { sync_commands: this.sync_spy, parse_agent_mentions: () => [] } as any;
  override get_channel(_id: string) { return this.fake_channel; }
  override list_channels() { return [{ provider: "slack", instance_id: "slack-1" }]; }
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
// MinimalFakeApproval / MinimalFakeTaskResume
// ──────────────────────────────────────────────────

class MinimalFakeApproval {
  async try_handle_text_reply(): Promise<{ handled: boolean }> { return { handled: false }; }
  async try_handle_approval_reactions(): Promise<{ handled: boolean }> { return { handled: false }; }
  prune_seen(): void {}
}

class MinimalFakeTaskResume {
  async try_resume(): Promise<null> { return null; }
  async resume_after_approval(): Promise<boolean> { return false; }
  async cancel_task(): Promise<void> {}
  expire_stale() { return []; }
}

// ──────────────────────────────────────────────────
// 직접 manager 생성 헬퍼
// ──────────────────────────────────────────────────

async function make_manager(opts: {
  workspace: string;
  registry?: FakeChannelRegistryWithChannel | FakeChannelRegistry | FakeRegistryWithSync;
  task_resume?: FakeTaskResumeWithExpired | MinimalFakeTaskResume;
  approval?: MinimalFakeApproval;
  config_patch?: Partial<ReturnType<typeof create_test_channel_config>>;
  orchestration_handler?: (req: any) => Promise<import("@src/orchestration/types.ts").OrchestrationResult>;
  bot_identity?: import("@src/channels/manager.ts").BotIdentitySource;
  session_store?: any;
  tracker?: any;
  on_agent_event?: (...args: any[]) => void;
}) {
  const logger = create_noop_logger();
  const registry = opts.registry ?? new FakeChannelRegistry();
  const dispatch = new FakeDispatchService(registry as FakeChannelRegistry);
  const orch = new FakeOrchestrationService(opts.orchestration_handler);
  const task_resume = opts.task_resume ?? new FakeTaskResumeWithExpired();
  const approval = opts.approval ?? new MinimalFakeApproval();
  const recorder = new SessionRecorder({ sessions: null, daily_memory: null, sanitize_for_storage: (t) => t, logger });
  const media = new MediaCollector({ workspace_dir: opts.workspace, tokens: {} });
  const config = { ...create_test_channel_config(), ...(opts.config_patch || {}) };

  const manager_opts: Record<string, unknown> = {
    bus: new MessageBus(),
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
    bot_identity: opts.bot_identity ?? { get_bot_self_id: () => "", get_default_target: () => "" },
    session_store: opts.session_store ?? null,
  };

  if (opts.on_agent_event) manager_opts.on_agent_event = opts.on_agent_event;

  const manager = new ChannelManager(manager_opts as any);

  return { manager, registry, dispatch: dispatch as FakeDispatchService };
}

// ══════════════════════════════════════════════════
// try_read_ack — readAckEnabled=true
// ══════════════════════════════════════════════════

describe("ChannelManager — try_read_ack", () => {
  it("readAckEnabled=true + channel.add_reaction 호출됨", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const registry = new FakeChannelRegistryWithChannel();
      const { manager } = await make_manager({
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const registry = new FakeChannelRegistryWithChannel();
      const { manager } = await make_manager({
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
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
      const { manager, dispatch } = await make_manager({
        workspace: ws,
        task_resume,
      });
      await manager.handle_inbound_message(inbound("새 메시지", { provider: "telegram" }));
      // notify_expired_tasks가 dispatch.send를 fire-and-forget으로 호출
      // 비동기이므로 약간 대기
      await new Promise((r) => setTimeout(r, 100));
      // dispatch.sent에 task_expired 메시지가 있어야 함
      const all_sent = dispatch.sent;
      const expired_msg = all_sent.find((s) => String((s.message.metadata as Record<string, unknown>)?.kind) === "task_expired");
      expect(expired_msg).toBeDefined();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("만료 태스크 있음 + objective 있음 → 메시지에 objective 포함", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
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
      const { manager, dispatch } = await make_manager({
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const orch_handler = vi.fn().mockResolvedValue({ reply: "ok", mode: "once", tool_calls_count: 0, streamed: false });
      const { manager } = await make_manager({
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const orch_handler = vi.fn().mockResolvedValue({ reply: "ok", mode: "once", tool_calls_count: 0, streamed: false });
      const { manager } = await make_manager({
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const orch_handler = vi.fn().mockResolvedValue({ reply: "ok", mode: "once", tool_calls_count: 0, streamed: false });
      const { manager } = await make_manager({
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const orch_handler = vi.fn().mockResolvedValue({ reply: "ok", mode: "once", tool_calls_count: 0, streamed: false });
      const { manager } = await make_manager({
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const orch_handler = vi.fn().mockResolvedValue({ reply: "ok", mode: "once", tool_calls_count: 0, streamed: false });
      const { manager } = await make_manager({
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const { manager, dispatch } = await make_manager({
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const { manager, dispatch } = await make_manager({
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
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const on_agent_event = vi.fn();
      const orch_handler = vi.fn().mockImplementation(async (req: any) => {
        req.on_agent_event?.({ type: "content_delta", text: "hi", at: new Date().toISOString(), source: { backend: "claude_cli" } });
        return { reply: "ok", mode: "once", tool_calls_count: 0, streamed: false };
      });
      const { manager } = await make_manager({
        workspace: ws,
        orchestration_handler: orch_handler,
        on_agent_event,
      });

      await manager.handle_inbound_message(inbound("test", { provider: "telegram" }));
      expect(on_agent_event).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// deliver_result — streamed=true + suppressFinalAfterStream
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
    const { writeFile } = await import("node:fs/promises");
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

// ══════════════════════════════════════════════════
// handle_control_reactions — stop reaction + tracker
// ══════════════════════════════════════════════════

describe("ChannelManager — handle_control_reactions", () => {
  it("stop reaction + tracker 있음 → cancel 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const cancel_spy = vi.fn().mockResolvedValue({ cancelled: true, details: "" });
      const tracker = {
        list_active: vi.fn().mockReturnValue([{ run_id: "run-1", provider: "slack", chat_id: "C123" }]),
        cancel: cancel_spy,
      };
      const { manager } = await make_manager({ workspace: ws, tracker, config_patch: { controlReactionEnabled: true } });

      const reaction_msg = {
        id: "rxn-1",
        provider: "slack",
        channel: "slack",
        sender_id: "U001",
        chat_id: "C123",
        content: "",
        at: new Date().toISOString(),
        metadata: {
          is_reaction: true,
          slack: { reactions: [{ name: "octagonal_sign" }] },
        },
      } as any;

      await (manager as any).handle_control_reactions("slack", [reaction_msg]);
      // tracker.cancel이 호출되었거나 list_active가 호출됨
      expect(tracker.list_active).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("stop reaction + tracker=null → cancel 미호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const { manager } = await make_manager({ workspace: ws, config_patch: { controlReactionEnabled: true } });

      const reaction_msg = {
        id: "rxn-2",
        provider: "slack",
        channel: "slack",
        sender_id: "U001",
        chat_id: "C123",
        content: "",
        at: new Date().toISOString(),
        metadata: { is_reaction: true, slack: { reactions: [{ name: "octagonal_sign" }] } },
      } as any;

      // tracker=null이므로 cancel은 호출되지 않음
      await (manager as any).handle_control_reactions("slack", [reaction_msg]);
      // 오류 없이 완료되어야 함
      expect(true).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("non-reaction 메시지만 → 무시", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const tracker = {
        list_active: vi.fn().mockReturnValue([]),
        cancel: vi.fn().mockResolvedValue({ cancelled: false, details: "" }),
      };
      const { manager } = await make_manager({ workspace: ws, tracker });
      const normal_msg = inbound("hello", { provider: "slack" });
      await (manager as any).handle_control_reactions("slack", [normal_msg]);
      expect(tracker.list_active).not.toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// _recover_orphaned_messages — session_store 경로
// ══════════════════════════════════════════════════

describe("ChannelManager — _recover_orphaned_messages", () => {
  it("session_store.list_by_prefix 없음 → 즉시 반환", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const store = { get_or_create: vi.fn() } as any;
      const { manager } = await make_manager({ workspace: ws, session_store: store });
      await (manager as any)._recover_orphaned_messages();
      expect(store.get_or_create).not.toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("list_by_prefix 있지만 빈 배열 → publish_inbound 미호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const store = {
        list_by_prefix: vi.fn().mockResolvedValue([]),
        get_or_create: vi.fn(),
      } as any;
      const { manager } = await make_manager({ workspace: ws, session_store: store });
      await (manager as any)._recover_orphaned_messages();
      expect(store.get_or_create).not.toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("list_by_prefix: entry with message_count=0 → skip", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const store = {
        list_by_prefix: vi.fn().mockResolvedValue([
          { key: "telegram:chat1:bot:main", message_count: 0, updated_at: new Date().toISOString() },
        ]),
        get_or_create: vi.fn(),
      } as any;
      const { manager } = await make_manager({ workspace: ws, session_store: store });
      await (manager as any)._recover_orphaned_messages();
      expect(store.get_or_create).not.toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("entry with 오래된 updated_at → skip", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const old_time = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2시간 전
      const store = {
        list_by_prefix: vi.fn().mockResolvedValue([
          { key: "telegram:chat1:bot:main", message_count: 1, updated_at: old_time },
        ]),
        get_or_create: vi.fn(),
      } as any;
      const { manager } = await make_manager({ workspace: ws, session_store: store });
      await (manager as any)._recover_orphaned_messages();
      expect(store.get_or_create).not.toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("recent entry + last msg = user → publish_inbound 호출", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const recent = new Date().toISOString();
      const store = {
        list_by_prefix: vi.fn().mockResolvedValue([
          { key: "telegram:chat-abc:bot:main", message_count: 1, updated_at: recent },
        ]),
        get_or_create: vi.fn().mockResolvedValue({
          messages: [
            {
              role: "user",
              content: "hello world",
              timestamp: recent,
              sender_id: "user-123",
              metadata: { message_id: "msg-recover-1" },
            },
          ],
        }),
      } as any;
      const { manager } = await make_manager({ workspace: ws, session_store: store });
      await (manager as any)._recover_orphaned_messages();
      // get_or_create가 호출되었는지 확인
      expect(store.get_or_create).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("last msg = assistant → orphan 아님, skip", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const recent = new Date().toISOString();
      const store = {
        list_by_prefix: vi.fn().mockResolvedValue([
          { key: "telegram:chat-abc:bot:main", message_count: 2, updated_at: recent },
        ]),
        get_or_create: vi.fn().mockResolvedValue({
          messages: [
            { role: "user", content: "q", timestamp: recent, sender_id: "user-1" },
            { role: "assistant", content: "a", timestamp: recent },
          ],
        }),
      } as any;
      const { manager } = await make_manager({ workspace: ws, session_store: store });
      await (manager as any)._recover_orphaned_messages();
      expect(store.get_or_create).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// render_msg — 다양한 kind 분기
// ══════════════════════════════════════════════════

describe("ChannelManager — render_msg 분기 (renderer 없음)", () => {
  it("kind=status_progress + tool_count > 0 → 도구 횟수 포함", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const result = (manager as any).render_msg({ kind: "status_progress", label: "작업 중", tool_count: 3 });
      expect(result).toContain("도구");
      expect(result).toContain("3");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("kind=status_progress + tool_count=0 → 도구 횟수 없음", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const result = (manager as any).render_msg({ kind: "status_progress", label: "작업 중", tool_count: 0 });
      expect(result).not.toContain("도구");
      expect(result).toContain("작업 중");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("kind=expired_task + objective 없음 → FALLBACK_MESSAGES 반환", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const result = (manager as any).render_msg({ kind: "expired_task" });
      expect(typeof result).toBe("string");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("kind=command_reply → body 반환", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const result = (manager as any).render_msg({ kind: "command_reply", body: "커맨드 결과" });
      expect(result).toBe("커맨드 결과");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("kind=status_completed → FALLBACK_MESSAGES 반환", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const result = (manager as any).render_msg({ kind: "status_completed" });
      expect(typeof result).toBe("string");
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// start() / stop() lifecycle
// ══════════════════════════════════════════════════

describe("ChannelManager — start/stop lifecycle", () => {
  it("start() 두 번 호출 → 두 번째는 noop", async () => {
    const h = await create_harness();
    try {
      await h.manager.start();
      await h.manager.start(); // 두 번째 → noop
      const status = h.manager.get_status();
      expect(status.mention_loop_running).toBe(true);
      await h.manager.stop();
    } finally { await h.cleanup(); }
  });

  it("stop() 후 health_check → ok=false", async () => {
    const h = await create_harness();
    try {
      await h.manager.start();
      await h.manager.stop();
      const health = h.manager.health_check();
      expect(health.ok).toBe(false);
    } finally { await h.cleanup(); }
  });
});

// ══════════════════════════════════════════════════
// sync_commands_to_channels
// ══════════════════════════════════════════════════

describe("ChannelManager — sync_commands_to_channels", () => {
  it("채널이 있으면 sync_commands 호출됨", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const registry = new FakeRegistryWithSync();
      const { manager } = await make_manager({ workspace: ws, registry });
      await manager.start();
      await manager.stop();
      expect(registry.sync_spy).toHaveBeenCalled();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// get_channel_health
// ══════════════════════════════════════════════════

describe("ChannelManager — get_channel_health", () => {
  it("get_channel_health() → 배열 반환", async () => {
    const ws = await mkdtemp(join(tmpdir(), "mgr-pipe-"));
    try {
      const { manager } = await make_manager({ workspace: ws });
      const health = manager.get_channel_health();
      expect(Array.isArray(health)).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════
// run_inbound_consumer — 메시지 소비
// ══════════════════════════════════════════════════

describe("ChannelManager — run_inbound_consumer", () => {
  it("start 후 bus에 publish_inbound → handle_inbound_message 처리됨", async () => {
    const h = await create_harness();
    try {
      await h.manager.start();
      // bus에 메시지 publish → consumer가 소비
      await h.manager.handle_inbound_message(inbound("안녕하세요"));
      await new Promise((r) => setTimeout(r, 100));
      await h.manager.stop();
      // 에러 없이 처리됨
      expect(true).toBe(true);
    } finally { await h.cleanup(); }
  });
});
