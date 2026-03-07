/**
 * Real E2E 하네스 — Mock Channel + 실제 파이프라인.
 *
 * TestChannel(ChatChannel 구현)이 유일한 Mock 경계:
 *   - send() → 아웃풋 캡처 (채널 발신 대신 검증용)
 *   - read() → 항상 빈 배열 (인풋은 handle_inbound_message 직접 호출)
 *
 * 나머지 전부(OrchestrationService, ProviderRegistry, AgentDomain 등)는 실제 서비스.
 */

import { mkdtemp, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InboundMessage, OutboundMessage } from "@src/bus/types.ts";
import { MessageBus } from "@src/bus/service.ts";
import type { ChannelProvider, ChannelRegistryLike, ChannelHealth, ChannelTypingState } from "@src/channels/types.ts";
import type { AppConfig } from "@src/config/schema.ts";

import { BaseChannel } from "@src/channels/base.ts";
import { ChannelManager } from "@src/channels/manager.ts";
import { CommandRouter } from "@src/channels/commands/router.ts";
import { OrchestrationService } from "@src/orchestration/service.ts";
import { AgentDomain } from "@src/agent/index.ts";
import { create_agent_runtime } from "@src/agent/runtime.service.ts";
import { ProviderRegistry } from "@src/providers/service.ts";
import { SecretVaultService } from "@src/security/secret-vault.ts";
import { DefaultRuntimePolicyResolver } from "@src/channels/runtime-policy.ts";
import { ApprovalService } from "@src/channels/approval.service.ts";
import { SessionRecorder } from "@src/channels/session-recorder.ts";
import { MediaCollector } from "@src/channels/media-collector.ts";
import { create_logger } from "@src/logger.ts";
import { load_env_files } from "@src/utils/env.ts";
import { TaskResumeService } from "@src/channels/task-resume.service.ts";
import { resolve_reply_to } from "@src/orchestration/service.ts";
import { FakeDispatchService, create_test_channel_config, inbound } from "@helpers/harness.ts";

// ─── TestChannel ────────────────────────────────────────────────────────────

export class TestChannel extends BaseChannel {
  readonly outbox: OutboundMessage[] = [];
  private resolve_fn: ((msg: OutboundMessage) => void) | null = null;

  constructor(provider: ChannelProvider = "telegram") {
    super(provider);
    this.running = true;
  }

  async start(): Promise<void> { this.running = true; }
  async stop(): Promise<void> { this.running = false; }

  async read(): Promise<InboundMessage[]> { return []; }

  async send(msg: OutboundMessage): Promise<{ ok: boolean; message_id?: string; error?: string }> {
    this.outbox.push(msg);
    if (this.resolve_fn) {
      const fn = this.resolve_fn;
      this.resolve_fn = null;
      fn(msg);
    }
    return { ok: true, message_id: `test-${this.outbox.length}` };
  }

  async edit_message(_chat_id: string, _message_id: string, _content: string): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }

  protected async set_typing_remote(): Promise<void> {}

  wait_for_output(timeout_ms = 60_000): Promise<OutboundMessage> {
    if (this.outbox.length > 0) return Promise.resolve(this.outbox[0]!);
    return new Promise<OutboundMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.resolve_fn = null;
        reject(new Error(`timeout: ${timeout_ms}ms 내에 아웃풋 없음`));
      }, timeout_ms);
      this.resolve_fn = (msg) => {
        clearTimeout(timer);
        resolve(msg);
      };
    });
  }

  clear(): void {
    this.outbox.length = 0;
    this.resolve_fn = null;
  }
}

// ─── TestChannelRegistry ────────────────────────────────────────────────────

export class TestChannelRegistry implements ChannelRegistryLike {
  private readonly channel: TestChannel;

  constructor(channel: TestChannel) { this.channel = channel; }

  async start_all(): Promise<void> { await this.channel.start(); }
  async stop_all(): Promise<void> { await this.channel.stop(); }

  get_channel(): TestChannel { return this.channel; }
  list_channels(): Array<{ provider: ChannelProvider }> {
    return [{ provider: this.channel.provider }];
  }

  async send(message: OutboundMessage): Promise<{ ok: boolean; message_id?: string; error?: string }> {
    return this.channel.send(message);
  }

  async edit_message(_provider: ChannelProvider, chat_id: string, message_id: string, content: string): Promise<{ ok: boolean; error?: string }> {
    return this.channel.edit_message(chat_id, message_id, content);
  }

  async add_reaction(): Promise<{ ok: boolean; error?: string }> { return { ok: true }; }
  async remove_reaction(): Promise<{ ok: boolean; error?: string }> { return { ok: true }; }

  async read(): Promise<InboundMessage[]> { return []; }

  async find_latest_agent_mention(): Promise<InboundMessage | null> { return null; }
  async set_typing(): Promise<void> {}
  get_typing_state(_provider: ChannelProvider, chat_id: string): ChannelTypingState | null {
    return { chat_id, typing: false, updated_at: new Date().toISOString() };
  }
  get_health(): ChannelHealth[] {
    return [{ provider: this.channel.provider, running: true }];
  }
}

// ─── 오케스트레이터 LLM 가용성 확인 ─────────────────────────────────────────────────────

/** 오케스트레이터 LLM 가용성 확인 + warm-up: /models 확인 후 간단한 추론 요청으로 모델을 메모리에 로드. */
export async function is_orchestrator_llm_available(): Promise<boolean> {
  const base = String(process.env.ORCHESTRATOR_LLM_API_BASE || "http://127.0.0.1:11434/v1").replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/models`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;

    // warm-up: 모델을 메모리에 로드 — cold start 시 첫 요청 timeout 방지
    const model = String(process.env.ORCHESTRATOR_LLM_MODEL || "qwen3:4b");
    await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 4 }),
      signal: AbortSignal.timeout(120_000),
    }).catch(() => {});

    return true;
  } catch {
    return false;
  }
}

// ─── Spotify 가용성 확인 ────────────────────────────────────────────────────

/** Spotify Desktop이 실행 가능한 환경인지 확인 (status 명령으로 테스트). */
export async function is_spotify_available(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  try {
    const script = join(process.cwd(), "workspace/skills/spotify-control/scripts/spotify_control.py");
    if (!existsSync(script)) return false;
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const exec = promisify(execFile);
    const { stdout } = await exec("python", [script, "--action", "status"], { timeout: 10_000 });
    const data = JSON.parse(stdout.trim());
    return data.ok === true;
  } catch {
    return false;
  }
}

// ─── Approval Policy ────────────────────────────────────────────────────────

export type ApprovalPolicy =
  | { type: "auto_approve" }
  | { type: "auto_deny" }
  | { type: "manual" }
  | { type: "callback"; decide: (tool_name: string, detail: string) => "approve" | "deny" | "defer" };

const DECISION_TEXT: Record<string, string> = {
  approve: "승인",
  deny: "거절",
  defer: "보류",
};

// ─── Real Harness ───────────────────────────────────────────────────────────

export type RealHarness = {
  workspace: string;
  channel: TestChannel;
  manager: ChannelManager;
  orchestration: OrchestrationService;
  agent_domain: AgentDomain;
  providers: ProviderRegistry;
  vault: SecretVaultService;
  /** 대기 중인 approval 요청에 수동으로 승인/거부를 주입. */
  send_decision: (decision: "approve" | "deny" | "defer", chat_id?: string) => Promise<void>;
  /** 마지막으로 수신된 approval 요청 정보. */
  last_approval_request: () => { request_id: string; tool_name: string; detail: string } | null;
  cleanup: () => Promise<void>;
};

const SOURCE_WORKSPACE = join(process.cwd(), "workspace");

// workspace/.env 로드 — executor 환경변수(CHATGPT_HEADLESS_COMMAND 등) 주입
load_env_files(SOURCE_WORKSPACE);

// E2E: codex sandbox setup이 Windows에서 간헐적 실패 → bypass
if (process.platform === "win32" && !process.env.ORCH_CODEX_BYPASS_SANDBOX) {
  process.env.ORCH_CODEX_BYPASS_SANDBOX = "1";
}

async function copy_workspace_assets(dest: string): Promise<void> {
  await Promise.all(
    ["skills", "templates", "agents"].map(async (dir) => {
      const src = join(SOURCE_WORKSPACE, dir);
      if (existsSync(src)) await cp(src, join(dest, dir), { recursive: true });
    }),
  );
}

export async function create_real_harness(options?: {
  provider?: ChannelProvider;
  approval_policy?: ApprovalPolicy;
}): Promise<RealHarness> {
  const provider: ChannelProvider = options?.provider || "telegram";
  const approval_policy: ApprovalPolicy = options?.approval_policy || { type: "manual" };
  const workspace = await mkdtemp(join(tmpdir(), "e2e-real-"));
  const logger = create_logger("e2e-real");

  await copy_workspace_assets(workspace);

  const bus = new MessageBus();
  const vault = new SecretVaultService(workspace);
  const providers = new ProviderRegistry({ secret_vault: vault, orchestrator_llm_model: "qwen3:4b" });
  const agent_domain = new AgentDomain(workspace, { providers, bus });

  await Promise.all([
    vault.ensure_ready(),
    agent_domain.start(),
  ]);
  const agent_runtime = create_agent_runtime(agent_domain);

  const policy_resolver = new DefaultRuntimePolicyResolver();

  const orchestration = new OrchestrationService({
    providers,
    agent_runtime,
    secret_vault: vault,
    runtime_policy_resolver: policy_resolver,
    config: {
      executor_provider: "orchestrator_llm",
      agent_loop_max_turns: 4,
      task_loop_max_turns: 8,
      streaming_enabled: false,
      streaming_interval_ms: 500,
      streaming_min_chars: 16,
      max_tool_result_chars: 4000,
    },
    logger,
    hitl_pending_store: new (await import("@src/orchestration/hitl-pending-store.ts")).HitlPendingStore(),
  });

  const channel = new TestChannel(provider);
  const registry = new TestChannelRegistry(channel);
  const dispatch = new FakeDispatchService(registry as unknown as import("@helpers/harness.ts").FakeChannelRegistry);

  // approval 요청 추적용 상태
  let _last_approval: { request_id: string; tool_name: string; detail: string } | null = null;
  let _manager_ref: ChannelManager | null = null;

  const approval = new ApprovalService({
    agent_runtime,
    send_reply: async (_prov: ChannelProvider, message: OutboundMessage) => {
      // approval 요청 메시지를 TestChannel로 전달 + 추적
      const meta = (message.metadata || {}) as Record<string, unknown>;
      if (meta.kind === "approval_request") {
        const orch = (meta.orchestrator_event || {}) as Record<string, unknown>;
        _last_approval = {
          request_id: String(message.content || "").match(/request_id:\s*(\S+)/)?.[1] || "",
          tool_name: String((orch.payload as Record<string, unknown>)?.tool || ""),
          detail: String(message.content || "").slice(0, 500),
        };
      }
      await channel.send(message);

      // auto-policy: approval 요청 감지 시 자동 결정 주입
      if (meta.kind === "approval_request" && approval_policy.type !== "manual" && _manager_ref) {
        const decision_key = approval_policy.type === "auto_approve" ? "approve"
          : approval_policy.type === "auto_deny" ? "deny"
          : approval_policy.type === "callback"
            ? approval_policy.decide(
                _last_approval?.tool_name || "",
                _last_approval?.detail || "",
              )
            : null;
        if (decision_key) {
          // 비동기로 결정 주입 — 현재 orchestration 실행과 겹치지 않도록 지연
          const mgr = _manager_ref;
          const text = DECISION_TEXT[decision_key] || "승인";
          queueMicrotask(() => {
            void mgr.handle_inbound_message(
              inbound(text, String(message.chat_id || "chat-1")),
            );
          });
        }
      }
      return { ok: true };
    },
    resolve_reply_to: (prov: ChannelProvider, msg: InboundMessage) => resolve_reply_to(prov, msg),
    logger,
  });

  const recorder = new SessionRecorder({
    sessions: null,
    daily_memory: null,
    sanitize_for_storage: (t) => t,
    logger,
  });
  const media_collector = new MediaCollector({ workspace_dir: workspace, tokens: {} });

  const config: AppConfig["channel"] = {
    ...create_test_channel_config(),
    autoReply: true,
  };

  const task_resume = new TaskResumeService({ agent_runtime, logger });

  const manager = new ChannelManager({
    bus,
    registry: registry as unknown as ChannelRegistryLike,
    dispatch: dispatch as unknown as import("@src/channels/dispatch.service.ts").DispatchService,
    command_router: new CommandRouter([]),
    orchestration,
    approval,
    task_resume,
    session_recorder: recorder,
    media_collector: media_collector,
    providers,
    config,
    workspace_dir: workspace,
    logger,
  });
  _manager_ref = manager;

  const send_decision = async (decision: "approve" | "deny" | "defer", chat_id = "chat-1"): Promise<void> => {
    const text = DECISION_TEXT[decision] || "승인";
    await manager.handle_inbound_message(inbound(text, chat_id));
  };

  const cleanup = async (): Promise<void> => {
    await agent_domain.stop();
    await remove_with_retry(workspace);
  };

  return {
    workspace, channel, manager, orchestration, agent_domain, providers, vault,
    send_decision,
    last_approval_request: () => _last_approval,
    cleanup,
  };
}

async function remove_with_retry(path: string): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    try { await rm(path, { recursive: true, force: true }); return; }
    catch { await new Promise<void>((r) => setTimeout(r, 40 * (i + 1))); }
  }
}

// ─── Assertion Helpers ──────────────────────────────────────────────────────

const HANGUL_RE = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g;

export function has_korean(text: string, min_ratio = 0.3): boolean {
  const clean = String(text || "").replace(/\s+/g, "");
  if (!clean) return false;
  const korean_count = (clean.match(HANGUL_RE) || []).length;
  return korean_count / clean.length >= min_ratio;
}

export function no_secret_leak(text: string): boolean {
  const t = String(text || "");
  if (/\{\{\s*secret:/i.test(t)) return false;
  if (/\bsv1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(t)) return false;
  return true;
}

export { inbound };
