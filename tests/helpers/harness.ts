/**
 * 테스트 하네스 — 새 ChannelManager DI 아키텍처에 맞는 공통 테스트 셋업.
 * 모든 서비스를 fake/stub으로 조립하여 ChannelManager를 테스트 가능한 상태로 제공.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InboundMessage, OutboundMessage } from "@src/bus/types.ts";
import { MessageBus } from "@src/bus/service.ts";
import type { ChannelProvider, ChannelRegistryLike } from "@src/channels/types.ts";
import type { AppConfig } from "@src/config/schema.ts";
import type { Logger } from "@src/logger.ts";
import type { OrchestrationRequest, OrchestrationResult } from "@src/orchestration/types.ts";
import { ChannelManager, type BotIdentitySource } from "@src/channels/manager.ts";
import { CommandRouter } from "@src/channels/commands/router.ts";
import type { CommandHandler } from "@src/channels/commands/types.ts";
import type { DispatchService } from "@src/channels/dispatch.service.ts";
import { ApprovalService } from "@src/channels/approval.service.ts";
import { SessionRecorder } from "@src/channels/session-recorder.ts";
import { MediaCollector } from "@src/channels/media-collector.ts";
import type { OrchestrationService } from "@src/orchestration/service.ts";
import type { TaskResumeService } from "@src/channels/task-resume.service.ts";

// --- Fake Logger ---

export function create_noop_logger(): Logger {
  const noop = () => {};
  const logger: Logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
  return logger;
}

// --- Fake Channel Registry ---

export type EditRecord = { provider: ChannelProvider; chat_id: string; message_id: string; content: string };
export type ReactionRecord = { provider: ChannelProvider; chat_id: string; message_id: string; reaction: string; action: "add" | "remove" };

export class FakeChannelRegistry {
  readonly sent: OutboundMessage[] = [];
  readonly edited: EditRecord[] = [];
  readonly reactions: ReactionRecord[] = [];
  readonly inbound_rows: InboundMessage[] = [];

  async start_all(): Promise<void> {}
  async stop_all(): Promise<void> {}
  list_channels(): Array<{ provider: ChannelProvider }> { return [{ provider: "telegram" }]; }
  get_channel(): null { return null; }
  async send(message: OutboundMessage): Promise<{ ok: boolean; message_id: string }> {
    this.sent.push(message);
    return { ok: true, message_id: String(this.sent.length) };
  }
  async edit_message(provider: ChannelProvider, chat_id: string, message_id: string, content: string): Promise<{ ok: boolean; error?: string }> {
    this.edited.push({ provider, chat_id, message_id, content });
    return { ok: true };
  }
  async add_reaction(provider: ChannelProvider, chat_id: string, message_id: string, reaction: string): Promise<{ ok: boolean; error?: string }> {
    this.reactions.push({ provider, chat_id, message_id, reaction, action: "add" });
    return { ok: true };
  }
  async remove_reaction(provider: ChannelProvider, chat_id: string, message_id: string, reaction: string): Promise<{ ok: boolean; error?: string }> {
    this.reactions.push({ provider, chat_id, message_id, reaction, action: "remove" });
    return { ok: true };
  }
  async read(_provider: ChannelProvider, _chat_id: string): Promise<InboundMessage[]> {
    return this.inbound_rows.filter((row) => row.chat_id === _chat_id);
  }
  async find_latest_agent_mention(
    _provider: ChannelProvider, chat_id: string, agent_alias: string, limit = 50,
  ): Promise<InboundMessage | null> {
    const rows = this.inbound_rows
      .filter((row) => row.chat_id === chat_id)
      .slice(-Math.max(1, Math.min(200, limit)));
    const needle = `@${agent_alias.trim().toLowerCase()}`;
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (String(rows[i]?.content || "").toLowerCase().includes(needle)) return rows[i] || null;
    }
    return null;
  }
  async set_typing(): Promise<void> {}
  get_typing_state() { return null; }
  get_health() { return []; }
}

// --- Fake Dispatch Service ---

export class FakeDispatchService {
  readonly name = "dispatch";
  readonly sent: Array<{ provider: ChannelProvider; message: OutboundMessage }> = [];
  private readonly registry: FakeChannelRegistry;

  constructor(registry: FakeChannelRegistry) { this.registry = registry; }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  health_check(): { ok: boolean } { return { ok: true }; }

  async send(provider: ChannelProvider, message: OutboundMessage): Promise<{ ok: boolean; message_id?: string; error?: string }> {
    this.sent.push({ provider, message });
    return this.registry.send(message);
  }
}

// --- Fake Orchestration Service ---

export type FakeOrchestrationHandler = (req: OrchestrationRequest) => Promise<OrchestrationResult>;

export class FakeOrchestrationService {
  handler: FakeOrchestrationHandler;

  constructor(handler?: FakeOrchestrationHandler) {
    this.handler = handler || (async () => ({
      reply: "ok",
      mode: "once" as const,
      tool_calls_count: 0,
      streamed: false,
    }));
  }

  async execute(req: OrchestrationRequest): Promise<OrchestrationResult> {
    return this.handler(req);
  }
}

// --- Fake Approval Service ---

export class FakeApprovalService {
  handle_result: { handled: boolean; task_id?: string; tool_result?: string } = { handled: false };
  async try_handle_text_reply(): Promise<{ handled: boolean; task_id?: string; tool_result?: string }> { return this.handle_result; }
  async try_handle_approval_reactions(): Promise<{ handled: boolean; task_id?: string; tool_result?: string }> { return { handled: false }; }
  prune_seen(): void {}
}

// --- Fake Task Resume Service ---

export class FakeTaskResumeService {
  async try_resume(): Promise<null> { return null; }
  expire_stale(): import("../../src/contracts.js").TaskState[] { return []; }
}

// --- Default Channel Config ---

export function create_test_channel_config(): AppConfig["channel"] {
  return {
    debug: false,
    autoReply: true,
    defaultAlias: "assistant",
    pollIntervalMs: 2000,
    readLimit: 30,
    readAckEnabled: false,
    readAckReaction: "eyes",
    statusNoticeEnabled: false,
    progressPulseEnabled: false,
    groupingEnabled: false,
    groupingWindowMs: 3500,
    groupingMaxMessages: 8,
    seenTtlMs: 86_400_000,
    seenMaxSize: 50_000,
    inboundConcurrency: 4,
    sessionHistoryMaxAgeMs: 1_800_000,
    approvalReactionEnabled: false,
    controlReactionEnabled: false,
    reactionActionTtlMs: 86_400_000,
    streaming: {
      enabled: false,
      mode: "live" as const,
      intervalMs: 1400,
      minChars: 48,
      suppressFinalAfterStream: false,
    },
    dispatch: {
      inlineRetries: 0,
      retryMax: 3,
      retryBaseMs: 700,
      retryMaxMs: 25_000,
      retryJitterMs: 250,
      dlqEnabled: false,
      dlqPath: "",
    },
    outboundDedupe: {
      ttlMs: 25_000,
      maxSize: 20_000,
    },
  };
}

// --- Inbound Message Factory ---

export function inbound(content: string, patch?: Partial<InboundMessage>): InboundMessage {
  const id = String(patch?.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const metadata = (patch?.metadata && typeof patch.metadata === "object")
    ? (patch.metadata as Record<string, unknown>)
    : {};
  return {
    id,
    provider: "telegram",
    channel: "telegram",
    sender_id: "user-1",
    chat_id: "chat-1",
    content,
    at: new Date().toISOString(),
    media: [],
    metadata: { message_id: id, ...metadata },
    ...patch,
  };
}

// --- Harness ---

export type HarnessOptions = {
  orchestration_handler?: FakeOrchestrationHandler;
  command_handlers?: CommandHandler[];
  approval_service?: ApprovalService | FakeApprovalService;
  task_resume_service?: TaskResumeService | FakeTaskResumeService;
  config_patch?: Partial<AppConfig["channel"]>;
  bot_identity?: BotIdentitySource;
  renderer?: import("@src/channels/persona-message-renderer.js").PersonaMessageRendererLike | null;
};

export type Harness = {
  workspace: string;
  manager: ChannelManager;
  bus: MessageBus;
  registry: FakeChannelRegistry;
  dispatch: FakeDispatchService;
  orchestration: FakeOrchestrationService;
  approval: FakeApprovalService | ApprovalService;
  recorder: SessionRecorder;
  media: MediaCollector;
  cleanup: () => Promise<void>;
};

export async function create_harness(options: HarnessOptions = {}): Promise<Harness> {
  const workspace = await mkdtemp(join(tmpdir(), "test-harness-"));
  const logger = create_noop_logger();
  const registry = new FakeChannelRegistry();
  const dispatch = new FakeDispatchService(registry);
  const orchestration = new FakeOrchestrationService(options.orchestration_handler);
  const approval = (options.approval_service || new FakeApprovalService()) as ApprovalService;
  const command_router = new CommandRouter(options.command_handlers || []);
  const recorder = new SessionRecorder({
    sessions: null,
    daily_memory: null,
    sanitize_for_storage: (t) => t,
    logger,
  });
  const media = new MediaCollector({ workspace_dir: workspace, tokens: {} });

  const config = { ...create_test_channel_config(), ...(options.config_patch || {}) };

  const bus = new MessageBus();

  const task_resume = (options.task_resume_service || new FakeTaskResumeService()) as TaskResumeService;

  const env_bot_identity: BotIdentitySource = {
    get_bot_self_id(provider: string): string {
      const key = `${provider.toUpperCase()}_BOT_USER_ID`;
      return process.env[key] || "";
    },
    get_default_target(_provider: string): string { return ""; },
  };
  const bot_identity = options.bot_identity || env_bot_identity;

  const manager = new ChannelManager({
    bus,
    registry: registry as unknown as ChannelRegistryLike,
    dispatch: dispatch as unknown as DispatchService,
    command_router,
    orchestration: orchestration as unknown as OrchestrationService,
    approval,
    task_resume: task_resume as unknown as TaskResumeService,
    session_recorder: recorder,
    media_collector: media,
    process_tracker: null,
    providers: {} as never,
    config,
    workspace_dir: workspace,
    logger,
    bot_identity,
    renderer: options.renderer ?? null,
  });

  const cleanup = async (): Promise<void> => {
    await manager.stop();
    await remove_with_retry(workspace);
  };

  return { workspace, manager, bus, registry, dispatch, orchestration, approval, recorder, media, cleanup };
}

async function remove_with_retry(path: string): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    try { await rm(path, { recursive: true, force: true }); return; }
    catch { await new Promise<void>((r) => setTimeout(r, 40 * (i + 1))); }
  }
}
