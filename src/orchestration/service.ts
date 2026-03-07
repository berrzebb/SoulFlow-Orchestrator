import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { InboundMessage } from "../bus/types.js";
import type { ChannelProvider } from "../channels/types.js";
import type { AgentRuntimeLike } from "../agent/runtime.types.js";
import type { ProviderRegistry } from "../providers/service.js";
import type { ChatMessage, RuntimeExecutionPolicy } from "../providers/types.js";
import type { RuntimePolicyResolver } from "../channels/runtime-policy.js";
import type { SecretVaultService } from "../security/secret-vault.js";
import type { TaskNode, CompactionFlushConfig } from "../agent/loop.js";
import type { Logger } from "../logger.js";
import type { ToolExecutionContext } from "../agent/tools/types.js";
import type { ExecutionMode, OrchestrationRequest, OrchestrationResult } from "./types.js";
import { StreamBuffer } from "../channels/stream-buffer.js";
import {
  sanitize_provider_output,
  normalize_agent_reply,
  extract_provider_error,
} from "../channels/output-sanitizer.js";
import { seal_inbound_sensitive_text } from "../security/inbound-seal.js";
import { redact_sensitive_text } from "../security/sensitive.js";
import { is_local_reference } from "../utils/local-ref.js";
import { resolve_executor_provider, type ExecutorProvider, type ProviderCapabilities } from "../providers/executor.js";
import { select_tools_for_request, rebuild_tool_index } from "./tool-selector.js";
import type { AgentBackendRegistry } from "../agent/agent-registry.js";
import type { AgentRunResult, AgentSession } from "../agent/agent.types.js";
import type { ToolSchema } from "../agent/tools/types.js";
import { create_cd_observer } from "../agent/cd-scoring.js";
import type { ProcessTrackerLike } from "./process-tracker.js";
import type { WorkflowEventService, AppendWorkflowEventInput } from "../events/index.js";
import { now_iso, now_ms, error_message, short_id } from "../utils/common.js";
// ── 추출 모듈 ──
import {
  build_once_overlay, build_agent_overlay, build_bootstrap_overlay,
  AGENT_TOOL_NUDGE,
  format_secret_notice, GUARD_SUMMARY_PROMPT,
} from "./prompts.js";
import { ConfirmationGuard, format_guard_prompt } from "./confirmation-guard.js";
import { FINISH_REASON_WARNINGS } from "../agent/finish-reason-warnings.js";
import { detect_escalation, is_once_escalation, is_agent_escalation } from "./classifier.js";
import { resolve_gateway } from "./gateway.js";
import {
  create_tool_call_handler, type ToolCallState, type ToolCallHandlerDeps,
} from "./tool-call-handler.js";
import {
  build_agent_hooks, create_stream_handler, flush_remaining, emit_execution_info,
  type AgentHooksBuilderDeps,
} from "./agent-hooks-builder.js";
import { PersonaMessageRenderer, type PersonaMessageRendererLike } from "../channels/persona-message-renderer.js";
import { HitlPendingStore } from "./hitl-pending-store.js";

/** run_once / run_agent_loop / run_task_loop / _try_native_task_execute 공통 인수. */
type RunExecutionArgs = {
  req: OrchestrationRequest;
  executor: ExecutorProvider;
  task_with_media: string;
  context_block: string;
  skill_names: string[];
  system_base: string;
  runtime_policy: RuntimeExecutionPolicy;
  tool_definitions: Array<Record<string, unknown>>;
  tool_ctx: ToolExecutionContext;
  skill_provider_prefs?: string[];
  /** execute()에서 한 번 계산된 scope ID. run_task_loop에서 재사용. */
  request_scope: string;
};

type OrchestratorConfig = {
  executor_provider: ExecutorProvider;
  provider_caps?: ProviderCapabilities;
  agent_loop_max_turns: number;
  task_loop_max_turns: number;
  streaming_enabled: boolean;
  streaming_interval_ms: number;
  streaming_min_chars: number;
  max_tool_result_chars: number;
  orchestrator_max_tokens: number;
};

export type OrchestrationServiceDeps = {
  providers: ProviderRegistry;
  agent_runtime: AgentRuntimeLike;
  secret_vault: SecretVaultService;
  runtime_policy_resolver: RuntimePolicyResolver;
  config: OrchestratorConfig;
  logger: Logger;
  /** Phase 2: native_tool_loop 분기용. 없으면 기존 providers 경로만 사용. */
  agent_backends?: AgentBackendRegistry | null;
  process_tracker?: ProcessTrackerLike | null;
  /** SDK 백엔드에 전달할 MCP 서버 설정 조회. */
  get_mcp_configs?: () => Record<string, { command: string; args?: string[]; env?: Record<string, string>; cwd?: string }>;
  /** 워크플로우 이벤트 기록 서비스. 없으면 이벤트 기록 스킵. */
  events?: WorkflowEventService | null;
  /** Phase Loop에서 사용할 workspace 경로. */
  workspace?: string;
  /** Phase Loop에서 사용할 SubagentRegistry. */
  subagents?: import("../agent/subagents.js").SubagentRegistry | null;
  /** Phase Loop 영속화 스토어. */
  phase_workflow_store?: import("../agent/phase-workflow-store.js").PhaseWorkflowStoreLike | null;
  /** SSE 브로드캐스트 (Phase Loop 이벤트 전파). lazy 참조 지원. */
  get_sse_broadcaster?: () => { broadcast_workflow_event(event: import("../agent/phase-loop.types.js").PhaseLoopEvent): void } | null;
  /** 실행 전 확인 가드. */
  confirmation_guard?: ConfirmationGuard | null;
  /** 메시지 버스 (Phase Loop 내 interaction 노드용). */
  bus?: import("../bus/types.js").MessageBusLike | null;
  /** Decision/Promise 서비스 (워크플로우 노드용). */
  decision_service?: import("../decision/service.js").DecisionService | null;
  promise_service?: import("../decision/promise.service.js").PromiseService | null;
  embed?: (texts: string[], opts: { model?: string; dimensions?: number }) => Promise<{ embeddings: number[][]; token_usage?: number }>;
  vector_store?: (op: string, opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
  oauth_fetch?: (service_id: string, opts: { url: string; method: string; headers?: Record<string, string>; body?: unknown }) => Promise<{ status: number; body: unknown; headers: Record<string, string> }>;
  get_webhook_data?: (path: string) => Promise<{ method: string; headers: Record<string, string>; body: unknown; query: Record<string, string> } | null>;
  wait_kanban_event?: (board_id: string, filter: { actions?: string[]; column_id?: string }) => Promise<{ card_id: string; board_id: string; action: string; actor: string; detail: Record<string, unknown>; created_at: string } | null>;
  create_task?: (opts: { title: string; objective: string; channel?: string; chat_id?: string; max_turns?: number; initial_memory?: Record<string, unknown> }) => Promise<{ task_id: string; status: string; result?: unknown; error?: string }>;
  query_db?: (datasource: string, query: string, params?: Record<string, unknown>) => Promise<{ rows: unknown[]; affected_rows: number }>;
  /** 페르소나 메시지 렌더러. 없으면 내부에서 lazy 생성. */
  renderer?: PersonaMessageRendererLike | null;
  /** HITL pending 응답 공유 store. */
  hitl_pending_store: HitlPendingStore;
  /** 도구 인덱스. 미지정 시 키워드 인덱스 미사용. */
  tool_index?: import("./tool-index.js").ToolIndex | null;
};


/**
 * 메시지 수신 → 실행 모드 분류(once/agent/task) → 프로바이더 실행 → 결과 반환.
 * ChannelManager로부터 독립된 단일 책임 서비스.
 */
export class OrchestrationService {
  private readonly providers: ProviderRegistry;
  private readonly runtime: AgentRuntimeLike;
  private readonly vault: SecretVaultService;
  private readonly policy_resolver: RuntimePolicyResolver;
  private readonly config: OrchestratorConfig;
  private readonly logger: Logger;
  private readonly agent_backends: AgentBackendRegistry | null;
  private readonly process_tracker: ProcessTrackerLike | null;
  private readonly get_mcp_configs: (() => Record<string, { command: string; args?: string[]; env?: Record<string, string>; cwd?: string }>) | null;
  private readonly events: WorkflowEventService | null;
  private readonly guard: ConfirmationGuard | null;
  private readonly deps: OrchestrationServiceDeps;
  private readonly session_cd = create_cd_observer();
  private readonly streaming_cfg: { enabled: boolean; interval_ms: number; min_chars: number };
  private readonly hooks_deps: AgentHooksBuilderDeps;
  private readonly tool_deps: ToolCallHandlerDeps;
  private readonly hitl_store: HitlPendingStore;
  private readonly tool_index: import("./tool-index.js").ToolIndex | null;
  private _renderer: PersonaMessageRendererLike | null;

  constructor(deps: OrchestrationServiceDeps) {
    this._renderer = deps.renderer ?? null;
    this.providers = deps.providers;
    this.runtime = deps.agent_runtime;
    this.vault = deps.secret_vault;
    this.policy_resolver = deps.runtime_policy_resolver;
    this.config = deps.config;
    this.logger = deps.logger;
    this.agent_backends = deps.agent_backends || null;
    this.process_tracker = deps.process_tracker || null;
    this.get_mcp_configs = deps.get_mcp_configs || null;
    this.events = deps.events || null;
    this.guard = deps.confirmation_guard || null;
    this.hitl_store = deps.hitl_pending_store;
    this.tool_index = deps.tool_index ?? null;
    this.deps = deps;

    this.streaming_cfg = {
      enabled: this.config.streaming_enabled,
      interval_ms: this.config.streaming_interval_ms,
      min_chars: this.config.streaming_min_chars,
    };
    this.hooks_deps = {
      session_cd: this.session_cd,
      logger: this.logger,
      process_tracker: this.process_tracker,
      runtime: this.runtime,
      log_event: (e: AppendWorkflowEventInput) => this.log_event(e),
      streaming_config: this.streaming_cfg,
    };
    this.tool_deps = {
      max_tool_result_chars: this.config.max_tool_result_chars,
      logger: this.logger,
      execute_tool: (name: string, params: Record<string, unknown>, ctx?: ToolExecutionContext) =>
        this.runtime.execute_tool(name, params, ctx),
      log_event: (e: AppendWorkflowEventInput) => this.log_event(e),
    };
  }

  // ── 페르소나 + 부트스트랩 ──

  /** SOUL.md에서 페르소나 이름 + BOOTSTRAP.md 존재 여부를 조회. */
  private _get_persona_context(): { name: string; bootstrap: { exists: boolean; content: string } } {
    const cb = this.runtime.get_context_builder();
    return { name: cb.get_persona_name(), bootstrap: cb.get_bootstrap() };
  }

  /** 모드에 맞는 overlay를 생성. bootstrap 모드면 bootstrap overlay가 우선. */
  private _build_overlay(mode: "once" | "agent", persona?: { name: string; bootstrap: { exists: boolean; content: string } }): string {
    const ctx = persona ?? this._get_persona_context();
    if (ctx.bootstrap.exists) return build_bootstrap_overlay(ctx.name, ctx.bootstrap.content);
    return mode === "once" ? build_once_overlay(ctx.name) : build_agent_overlay(ctx.name);
  }

/** Phase Loop HITL bridge — ChannelManager에서 사용자 응답을 라우팅. */
  get_phase_hitl_bridge(): import("../channels/manager.js").WorkflowHitlBridge {
    const store = this.hitl_store;
    return {
      async try_resolve(chat_id: string, content: string): Promise<boolean> {
        return store.try_resolve(chat_id, content);
      },
    };
  }

  private _caps(): ProviderCapabilities {
    return this.config.provider_caps ?? { chatgpt_available: true, claude_available: false, openrouter_available: false };
  }

  /** 공통 AgentHooks 구성. args.req + stream + backend_id 조합. */
  private _hooks_for(stream: StreamBuffer, args: { req: OrchestrationRequest; runtime_policy: RuntimeExecutionPolicy }, backend_id: string, task_id?: string) {
    return build_agent_hooks(this.hooks_deps, {
      buffer: stream, on_stream: args.req.on_stream, runtime_policy: args.runtime_policy,
      channel_context: { channel: args.req.provider, chat_id: String(args.req.message.chat_id || ""), task_id },
      on_tool_block: args.req.on_tool_block, backend_id, on_progress: args.req.on_progress,
      run_id: args.req.run_id, on_agent_event: args.req.on_agent_event,
    }).hooks;
  }

  /** 세션 누적 CD 점수 조회. */
  get_cd_score(): { total: number; events: Array<{ indicator: string; points: number; context: string; at: string }> } {
    return this.session_cd.get_score();
  }

  /** 세션 CD 점수 초기화. */
  reset_cd_score(): void {
    this.session_cd.reset();
  }

  /** 가드 확인용 요약 생성. 오케스트레이터 LLM 사용, 실패 시 텍스트 슬라이스 폴백. */
  private async _generate_guard_summary(task_text: string): Promise<string> {
    try {
      const result = await this.providers.run_orchestrator({
        messages: [
          { role: "system", content: GUARD_SUMMARY_PROMPT },
          { role: "user", content: task_text.slice(0, 500) },
        ],
        max_tokens: 150,
        temperature: 0,
      });
      const summary = String(result.content || "").trim();
      if (summary) return summary;
    } catch { /* 오케스트레이터 미설정 시 폴백 */ }
    return task_text.slice(0, 200) + (task_text.length > 200 ? "..." : "");
  }

/** 워크플로우 이벤트 기록. events 서비스가 없으면 무시. */
  private log_event(input: AppendWorkflowEventInput): void {
    if (!this.events) return;
    this.events.append(input).catch(() => { /* 이벤트 로깅 실패가 실행을 차단하면 안 됨 */ });
  }

  async execute(req: OrchestrationRequest): Promise<OrchestrationResult> {
    const task = await this.seal_text(req.provider, req.message.chat_id, String(req.message.content || "").trim());
    const media = await this.seal_list(req.provider, req.message.chat_id, req.media_inputs);
    const task_with_media = compose_task_with_media(task, media);

    // HITL: TaskResumeService가 이미 resume_task()를 호출하여 running 상태로 전환 → 기존 task loop 이어서 실행
    if (req.resumed_task_id) {
      const resumed = await this.runtime.get_task(req.resumed_task_id);
      if (resumed && resumed.status === "running") {
        return this.continue_task_loop(req, resumed, task_with_media, media);
      }
    }

    const always_skills = this.runtime.get_always_skills();
    const skill_names = this.resolve_context_skills(task_with_media, always_skills);

    const secret_guard = await this.inspect_secrets([task_with_media, ...media]);
    if (!secret_guard.ok) {
      return { reply: format_secret_notice(secret_guard), mode: "once", tool_calls_count: 0, streamed: false };
    }

    const runtime_policy = this.policy_resolver.resolve(task_with_media, media);
    const all_tool_definitions = this.runtime.get_tool_definitions();
    const request_scope = inbound_scope_id(req.message);
    const request_task_id = `adhoc:${req.provider}:${req.message.chat_id}:${req.alias}:${request_scope}`.toLowerCase();
    const run_id = req.run_id || `orch-${now_ms()}`;

    // 워크플로우 이벤트: 요청 수신 기록
    const evt_base: Pick<AppendWorkflowEventInput, "run_id" | "task_id" | "agent_id" | "provider" | "channel" | "chat_id" | "source"> = {
      run_id,
      task_id: request_task_id,
      agent_id: req.alias,
      provider: req.provider,
      channel: req.provider,
      chat_id: req.message.chat_id,
      source: "inbound",
    };
    this.log_event({ ...evt_base, phase: "assign", summary: `channel request: ${req.alias}`, detail: task_with_media.slice(0, 500) });

    const history_lines = req.session_history.slice(-8).map((r) => `[${r.role}] ${r.content}`);
    const context_block = build_context_message(task_with_media, history_lines);
    const tool_ctx = build_tool_context(req, request_task_id);

    const skill_tool_names = this.collect_skill_tool_names(skill_names);
    const active_tasks_in_chat = this.runtime.list_active_tasks().filter(
      (t) => String(t.memory?.chat_id || "") === String(req.message.chat_id),
    );
    const category_map: Record<string, string> = {};
    for (const tool of this.runtime.get_tool_executors()) {
      category_map[tool.name] = tool.category;
    }
    const tool_categories = [...new Set(Object.values(category_map))];
    const tool_index_db = this.deps.workspace
      ? join(this.deps.workspace, "runtime", "tools", "tool-index.db")
      : undefined;
    rebuild_tool_index(all_tool_definitions as ToolSchema[], category_map, tool_index_db, this.tool_index);
    const skill_provider_prefs = this._collect_skill_provider_preferences(skill_names);

    // Gateway: 분류 + 라우팅 결정
    const decision = await resolve_gateway(
      task_with_media,
      {
        active_tasks: active_tasks_in_chat,
        recent_history: req.session_history.slice(-6),
        available_tool_categories: tool_categories,
        available_skills: skill_names.map(name => {
          const meta = this.runtime.get_context_builder().skills_loader.get_skill_metadata(name);
          return meta
            ? { name, summary: meta.summary, triggers: meta.triggers }
            : { name, summary: "", triggers: [] };
        }),
      },
      active_tasks_in_chat,
      {
        providers: this.providers,
        provider_caps: this._caps(),
        executor_preference: this.config.executor_provider,
        session_lookup: (task_id: string) => this.runtime.find_session_by_task(task_id),
        logger: this.logger,
      },
    );

    if (decision.action === "identity") {
      const identity_reply = this._build_identity_reply();
      this.log_event({ ...evt_base, phase: "done", summary: "identity shortcircuit", payload: { mode: "identity" } });
      return { reply: identity_reply, mode: "once", tool_calls_count: 0, streamed: false };
    }

    if (decision.action === "builtin") {
      this.log_event({ ...evt_base, phase: "done", summary: `builtin: ${decision.command}`, payload: { mode: "builtin", command: decision.command } });
      return { reply: null, mode: "once", tool_calls_count: 0, streamed: false, builtin_command: decision.command, builtin_args: decision.args };
    }

    if (decision.action === "inquiry") {
      this.log_event({ ...evt_base, phase: "done", summary: "inquiry shortcircuit", payload: { mode: "inquiry", active_count: active_tasks_in_chat.length } });
      return { reply: decision.summary, mode: "once", tool_calls_count: 0, streamed: false };
    }

    const { mode, executor } = decision;

    // 결과에 done/blocked 이벤트를 기록하는 헬퍼
    const finalize = (result: OrchestrationResult): OrchestrationResult => {
      const phase = result.error ? "blocked" : "done";
      this.log_event({
        ...evt_base,
        phase,
        summary: result.error ? `failed: ${result.error.slice(0, 120)}` : `completed: ${result.mode}`,
        payload: { mode: result.mode, tool_calls_count: result.tool_calls_count, ...(result.usage ?? {}), ...(result.error ? { error: result.error } : {}) },
        detail: result.error || (result.reply ?? "").slice(0, 500) || null,
      });
      if (req.run_id) {
        this.process_tracker?.set_tool_count(req.run_id, result.tool_calls_count);
        this.process_tracker?.end(req.run_id, result.error ? "failed" : "completed", result.error || undefined);
      }
      return result;
    };

    // phase → Phase Loop Runner에 위임 (도구 선택 전에 분기)
    if (mode === "phase") {
      this.log_event({ ...evt_base, phase: "progress", summary: "executing: phase", payload: { mode, executor } });
      const workflow_hint = decision.workflow_id;
      const node_cats = decision.node_categories;
      return finalize(await this.run_phase_loop(req, task_with_media, workflow_hint, node_cats));
    }

    const classifier_cats = decision.action === "execute" ? decision.tool_categories : undefined;
    const { tools: tool_definitions, categories } = await select_tools_for_request(all_tool_definitions, task_with_media, mode, skill_tool_names, classifier_cats, category_map, classifier_cats, this.tool_index);
    const system_base = await this._build_system_prompt(skill_names, req.provider, req.message.chat_id, new Set(categories), req.alias);
    this.logger.info("dispatch", { mode, executor, skills: skill_names, tool_count: tool_definitions.length });

    // ── Confirmation Guard: 중요 작업 실행 전 사용자 확인 ──
    if (this.guard?.needs_confirmation(mode, categories, req.provider, req.message.chat_id)) {
      const summary = await this._generate_guard_summary(task_with_media);
      this.guard.store(req.provider, req.message.chat_id, task_with_media, summary, mode, categories);
      this.logger.info("guard_confirmation_pending", { mode, categories, provider: req.provider, chat_id: req.message.chat_id });
      return { reply: format_guard_prompt(summary, mode, categories), mode: "once", tool_calls_count: 0, streamed: false };
    }

    if (req.run_id) {
      this.process_tracker?.set_mode(req.run_id, mode);
      this.process_tracker?.set_executor(req.run_id, executor);
    }
    this.log_event({ ...evt_base, phase: "progress", summary: `executing: ${mode}`, payload: { mode, executor } });

    // once → executor 1회 호출. 에스컬레이션 시 executor 루프로 전환.
    try {
      let escalation_error: string | undefined;
      if (mode === "once") {
        const once_result = await this.run_once({
          req, executor, task_with_media, context_block, skill_names, system_base,
          runtime_policy, tool_definitions, tool_ctx, skill_provider_prefs, request_scope,
        });
        if (!is_once_escalation(once_result.error)) {
          return finalize(once_result);
        }
        escalation_error = once_result.error ?? undefined;
      }

      // agent/task 또는 once 에스컬레이션 → executor 루프
      const loop_mode: "task" | "agent" = mode === "task"
        ? "task"
        : (escalation_error === "once_requires_task_loop" ? "task" : "agent");

      if (req.run_id && loop_mode !== mode) this.process_tracker?.set_mode(req.run_id, loop_mode);

      const run_loop = async (executor: ExecutorProvider): Promise<OrchestrationResult> => {
        const loop_args = {
          req, executor, task_with_media, media, context_block,
          skill_names, system_base, runtime_policy, tool_definitions, tool_ctx, skill_provider_prefs, request_scope,
        };
        return loop_mode === "task"
          ? this.run_task_loop(loop_args)
          : this.run_agent_loop({ ...loop_args, history_lines });
      };

      const first = await run_loop(executor);

      // agent → task 에스컬레이션: agent 루프가 approval 필요 상황을 감지한 경우
      if (loop_mode === "agent" && is_agent_escalation(first.error)) {
        this.logger.info("agent_escalation_to_task", { error: first.error, run_id: req.run_id });
        if (req.run_id) this.process_tracker?.set_mode(req.run_id, "task");
        const task_args = {
          req, executor, task_with_media, media, context_block,
          skill_names, system_base, runtime_policy, tool_definitions, tool_ctx, skill_provider_prefs, request_scope,
        };
        const escalated = await this.run_task_loop(task_args);
        return finalize(escalated);
      }

      if (first.reply || first.suppress_reply) return finalize(first);

      if (executor === "claude_code") {
        const fallback = resolve_executor_provider("chatgpt", this._caps());
        if (fallback !== executor) {
          this.logger.warn("executor failed, trying fallback", { executor, fallback, error: first.error });
          const second = await run_loop(fallback);
          if (second.reply || second.suppress_reply) return finalize(second);
          return finalize({ ...second, error: second.error || first.error });
        }
      }
      return finalize(first);
    } catch (e) {
      const msg = error_message(e);
      this.logger.error("execute unhandled", { error: msg });
      return finalize(error_result(mode, new StreamBuffer(), msg));
    }
  }

  /** executor에게 1회 질의. 오케스트레이터 LLM은 분류만 수행하고 실제 응답은 executor가 생성. */
  private async run_once(args: RunExecutionArgs): Promise<OrchestrationResult> {
    const stream = new StreamBuffer();
    emit_execution_info(stream, args.req.on_stream, "once", args.executor, this.logger);
    const { system_base } = args;
    const messages: ChatMessage[] = [
      { role: "system", content: `${system_base}\n\n${this._build_overlay("once")}` },
      { role: "user", content: args.context_block },
    ];

    // native_tool_loop 백엔드: 스마트 라우팅 우선, 레거시 폴백.
    if (this.agent_backends) {
      const backend = this.agent_backends.resolve_for_mode("once", args.skill_provider_prefs)
        ?? this.agent_backends.resolve_backend(args.executor);
      if (backend?.native_tool_loop) {
        try {
          const caps = backend.capabilities;
          const result = await this.agent_backends.run(backend.id, {
            task: args.context_block,
            task_id: `once:${args.req.provider}:${args.req.message.chat_id}`,
            system_prompt: String(messages[0].content || ""),
            tools: args.tool_definitions as ToolSchema[],
            tool_executors: this.runtime.get_tool_executors(),
            runtime_policy: args.runtime_policy,
            max_tokens: 1600,
            temperature: 0.3,
            max_turns: this.config.agent_loop_max_turns,
            effort: "medium",
            ...(caps.thinking ? { enable_thinking: true, max_thinking_tokens: 10000 } : {}),
            hooks: this._hooks_for(stream, args, backend.id, args.tool_ctx.task_id),
            abort_signal: args.req.signal,
            cwd: this.deps.workspace,
            mcp_server_configs: this.get_mcp_configs?.() ?? undefined,
            tool_context: args.tool_ctx,
          });
          flush_remaining(stream, args.req.on_stream);
          return this._convert_agent_result(result, "once", stream, args.req);
        } catch (e) {
          const msg = error_message(e);
          this.logger.warn("native_tool_loop run_once error", { error: msg });
          return error_result("once", stream, msg);
        }
      }
    }

    try {
      const response = await this.providers.run_headless({
        provider_id: args.executor,
        messages,
        tools: args.tool_definitions,
        max_tokens: 1600,
        temperature: 0.3,
        runtime_policy: args.runtime_policy,
        abort_signal: args.req.signal,
        on_stream: create_stream_handler(this.streaming_cfg, stream, args.req.on_stream),
      });

      const err = extract_provider_error(String(response.content || ""));
      if (err) return error_result("once", stream, err);

      if (response.has_tool_calls) {
        this.logger.debug("once: tool calls", { count: response.tool_calls.length });
        const tool_state: ToolCallState = { suppress: false, tool_count: 0 };
        const handler = create_tool_call_handler(this.tool_deps, args.tool_ctx, tool_state, {
          buffer: stream, on_stream: args.req.on_stream, on_tool_block: args.req.on_tool_block,
          on_tool_event: (e) => this.session_cd.observe(e),
          log_ctx: args.req.run_id ? { run_id: args.req.run_id, agent_id: String(args.executor), provider: args.req.provider, chat_id: args.req.message.chat_id } : undefined,
        });
        const tool_output = await handler({ tool_calls: response.tool_calls });

        if (tool_state.suppress) return suppress_result("once", stream, tool_state.tool_count);

        const followup = await this.providers.run_headless({
          provider_id: args.executor,
          messages: [
            ...messages,
            { role: "assistant", content: `[TOOL_RESULTS]\n${tool_output}` },
            { role: "user", content: this.build_persona_followup(this.runtime.get_context_builder().skills_loader.get_role_skill("concierge")?.heart || "") },
          ],
          max_tokens: 800,
          temperature: 0.2,
          abort_signal: args.req.signal,
          on_stream: create_stream_handler(this.streaming_cfg, stream, args.req.on_stream),
        });
        flush_remaining(stream, args.req.on_stream);
        const followup_text = sanitize_provider_output(String(followup.content || "")).trim();
        const final_text = followup_text || tool_output;
        return reply_result("once", stream, normalize_agent_reply(final_text, args.req.alias, args.req.message.sender_id), tool_state.tool_count);
      }

      flush_remaining(stream, args.req.on_stream);
      const content = sanitize_provider_output(String(response.content || ""));
      const final = content.trim();
      if (!final) return error_result("once", stream, "executor_once_empty");

      const escalation = detect_escalation(final);
      if (escalation) return error_result("once", stream, escalation);

      return reply_result("once", stream, normalize_agent_reply(final, args.req.alias, args.req.message.sender_id), 0);
    } catch (e) {
      const msg = error_message(e);
      this.logger.warn("run_once error", { error: msg });
      return error_result("once", stream, msg);
    }
  }

  /** 컨텍스트 압축 전 메모리 자동 저장 설정 생성. 200K 컨텍스트 기준. */
  private build_compaction_flush(): CompactionFlushConfig | undefined {
    const mem = this.runtime.get_context_builder()?.memory_store;
    if (!mem) return undefined;
    return {
      context_window: 200_000,
      flush: async () => {
        try { await mem.append_daily(`[auto-flush] Session nearing compaction — durable memories preserved.\n`); } catch { /* best-effort */ }
      },
    };
  }

  private async run_agent_loop(args: RunExecutionArgs & { media: string[]; history_lines: string[] }): Promise<OrchestrationResult> {
    const stream = new StreamBuffer();
    emit_execution_info(stream, args.req.on_stream, "agent", args.executor, this.logger);

    // native backend 우선: 스마트 라우팅 → 레거시 폴백
    if (this.agent_backends) {
      const backend = this.agent_backends.resolve_for_mode("agent", args.skill_provider_prefs)
        ?? this.agent_backends.resolve_backend(args.executor);
      if (backend?.native_tool_loop) {
        try {
          const system = args.system_base;
          const caps = backend.capabilities;
          const result = await this.agent_backends.run(backend.id, {
            task: args.context_block,
            task_id: `agent:${args.req.provider}:${args.req.message.chat_id}:${args.req.alias}`,
            system_prompt: `${system}\n\n${this._build_overlay("agent")}`,
            tools: args.tool_definitions as ToolSchema[],
            tool_executors: this.runtime.get_tool_executors(),
            runtime_policy: args.runtime_policy,
            max_tokens: 1800,
            temperature: 0.3,
            max_turns: this.config.agent_loop_max_turns,
            effort: "high",
            ...(caps.thinking ? { enable_thinking: true, max_thinking_tokens: 16000 } : {}),
            hooks: this._hooks_for(stream, args, backend.id, args.tool_ctx.task_id),
            abort_signal: args.req.signal,
            cwd: this.deps.workspace,
            mcp_server_configs: this.get_mcp_configs?.() ?? undefined,
            tool_context: args.tool_ctx,
          });
          flush_remaining(stream, args.req.on_stream);
          return this._convert_agent_result(result, "agent", stream, args.req);
        } catch (e) {
          const msg = error_message(e);
          this.logger.warn("native_tool_loop run_agent_loop error, falling back to legacy", { error: msg });
          // fallback: legacy headless 경로
        }
      }
    }

    // legacy headless 경로
    const state: ToolCallState = { suppress: false, tool_count: 0 };

    const loop_id = `loop-${now_ms()}-${short_id(8)}`;
    if (args.req.run_id) this.process_tracker?.link_loop(args.req.run_id, loop_id);

    const response = await this.runtime.run_agent_loop({
      loop_id,
      agent_id: args.req.alias,
      objective: args.task_with_media || "handle inbound request",
      context_builder: this.runtime.get_context_builder(),
      providers: this.providers,
      tools: args.tool_definitions,
      provider_id: args.executor,
      runtime_policy: args.runtime_policy,
      current_message: `${this._build_overlay("agent")}\n\n${args.context_block}`,
      history_days: [],
      skill_names: args.skill_names,
      media: args.media,
      channel: args.req.provider,
      chat_id: args.req.message.chat_id,
      max_turns: this.config.agent_loop_max_turns,
      model: undefined,
      max_tokens: 1800,
      temperature: 0.3,
      abort_signal: args.req.signal,
      on_stream: create_stream_handler(this.streaming_cfg, stream, args.req.on_stream),
      check_should_continue: async ({ state }) => {
        if (state.currentTurn >= (this.config.agent_loop_max_turns ?? 10)) return false;
        return AGENT_TOOL_NUDGE;
      },
      on_tool_calls: create_tool_call_handler(this.tool_deps, args.tool_ctx, state, {
        buffer: stream, on_stream: args.req.on_stream, on_tool_block: args.req.on_tool_block,
        on_tool_event: (e) => this.session_cd.observe(e),
        log_ctx: args.req.run_id ? { run_id: args.req.run_id, agent_id: String(args.executor), provider: args.req.provider, chat_id: args.req.message.chat_id } : undefined,
      }),
      compaction_flush: this.build_compaction_flush(),
    });

    flush_remaining(stream, args.req.on_stream);

    if (state.suppress) return suppress_result("agent", stream, state.tool_count);

    const content = sanitize_provider_output(String(response.final_content || ""));
    if (!content) return error_result("agent", stream, "empty_provider_response", state.tool_count);

    // agent → task 에스컬레이션 감지 (legacy 경로)
    const escalation = detect_escalation(content, "agent");
    if (escalation) return error_result("agent", stream, escalation, state.tool_count);

    const err = extract_provider_error(content);
    if (err) return error_result("agent", stream, err, state.tool_count);

    const reply = normalize_agent_reply(content, args.req.alias, args.req.message.sender_id);
    if (!reply) return error_result("agent", stream, "empty_provider_response", state.tool_count);
    const final_reply = state.tool_count === 0 ? append_no_tool_notice(reply) : reply;
    return reply_result("agent", stream, final_reply, state.tool_count);
  }

  private async run_task_loop(args: RunExecutionArgs & { media: string[] }): Promise<OrchestrationResult> {
    const stream = new StreamBuffer();
    emit_execution_info(stream, args.req.on_stream, "task", args.executor, this.logger);
    const task_id = `task:${args.req.provider}:${args.req.message.chat_id}:${args.req.alias}:${args.request_scope}`.toLowerCase();
    if (args.req.run_id) this.process_tracker?.link_task(args.req.run_id, task_id);
    this.log_event({
      run_id: args.req.run_id || `task-${Date.now()}`,
      task_id, agent_id: args.req.alias,
      provider: args.req.provider, channel: args.req.provider, chat_id: args.req.message.chat_id,
      source: "inbound",
      phase: "progress", summary: `task_started: ${task_id}`,
      payload: { mode: "task", executor: args.executor },
    });
    const FILE_WAIT_MARKER = "__file_request_waiting__";
    let total_tool_count = 0;

    const nodes: TaskNode[] = [
      {
        id: "plan",
        run: async ({ memory }) => ({
          memory_patch: { ...memory, seed_prompt: args.context_block, mode: "task_loop" },
          next_step_index: 1,
          current_step: "plan",
        }),
      },
      {
        id: "execute",
        run: async ({ task_state, memory }) => {
          const task_tool_ctx: ToolExecutionContext = { ...args.tool_ctx, task_id };
          const objective = task_state.objective || String(memory.objective || args.task_with_media);
          const seed_prompt = String(memory.seed_prompt || args.context_block);

          // native backend 우선: 전체 tool loop를 백엔드에 위임
          const native_result = await this._try_native_task_execute(args, stream, task_tool_ctx, task_id, objective, seed_prompt);
          if (native_result) {
            flush_remaining(stream, args.req.on_stream);
            const final = sanitize_provider_output(String(native_result.content || "")).trim();
            total_tool_count += native_result.tool_calls_count;
            if (native_result.finish_reason === "cancelled") {
              return { status: "completed", memory_patch: { ...memory, suppress_final_reply: true, last_output: final }, current_step: "execute", exit_reason: "cancelled" };
            }
            if (native_result.finish_reason === "approval_required") {
              return { status: "waiting_approval", memory_patch: { ...memory, last_output: final }, current_step: "execute", exit_reason: "waiting_approval" };
            }
            if (final.includes("__request_user_choice__")) {
              return { status: "waiting_user_input" as const, memory_patch: { ...memory, last_output: final }, current_step: "execute", exit_reason: "waiting_user_input" };
            }
            return { memory_patch: { ...memory, last_output: final }, next_step_index: 2, current_step: "execute" };
          }

          // legacy headless 경로
          const state: ToolCallState = { suppress: false, file_requested: false, done_sent: false, tool_count: 0 };

          const nested_loop_id = `nested-${now_ms()}-${short_id(8)}`;
          if (args.req.run_id) this.process_tracker?.link_loop(args.req.run_id, nested_loop_id);

          const response = await this.runtime.run_agent_loop({
            loop_id: nested_loop_id,
            agent_id: args.req.alias,
            objective,
            context_builder: this.runtime.get_context_builder(),
            providers: this.providers,
            tools: args.tool_definitions,
            provider_id: args.executor,
            runtime_policy: args.runtime_policy,
            current_message: `${this._build_overlay("agent")}\n\n${seed_prompt}`,
            history_days: [],
            skill_names: args.skill_names,
            media: args.media,
            channel: args.req.provider,
            chat_id: args.req.message.chat_id,
            max_turns: this.config.agent_loop_max_turns,
            model: undefined,
            max_tokens: 1800,
            temperature: 0.3,
            abort_signal: args.req.signal,
            on_stream: create_stream_handler(this.streaming_cfg, stream, args.req.on_stream),
            check_should_continue: async () => false,
            on_tool_calls: create_tool_call_handler(this.tool_deps,task_tool_ctx, state, {
              buffer: stream, on_stream: args.req.on_stream, on_tool_block: args.req.on_tool_block,
              on_tool_event: (e) => this.session_cd.observe(e),
              log_ctx: args.req.run_id ? { run_id: args.req.run_id, agent_id: String(args.executor), provider: args.req.provider, chat_id: args.req.message.chat_id } : undefined,
            }),
            compaction_flush: this.build_compaction_flush(),
          });

          flush_remaining(stream, args.req.on_stream);
          const final = sanitize_provider_output(String(response.final_content || "")).trim();

          if (state.file_requested) {
            return { status: "completed", memory_patch: { ...memory, file_request_waiting: true, last_output: FILE_WAIT_MARKER }, current_step: "execute", exit_reason: "file_request_waiting" };
          }
          if (state.done_sent) {
            return { status: "completed", memory_patch: { ...memory, suppress_final_reply: true, last_output: final }, current_step: "execute", exit_reason: "message_done_sent" };
          }
          if (final.includes("approval_required")) {
            return { status: "waiting_approval", memory_patch: { ...memory, last_output: final }, current_step: "execute", exit_reason: "waiting_approval" };
          }
          if (final.includes("__request_user_choice__")) {
            return { status: "waiting_user_input" as const, memory_patch: { ...memory, last_output: final }, current_step: "execute", exit_reason: "waiting_user_input" };
          }
          total_tool_count += state.tool_count;
          return { memory_patch: { ...memory, last_output: final }, next_step_index: 2, current_step: "execute" };
        },
      },
      {
        id: "finalize",
        run: async ({ memory }) => ({ status: "completed", memory_patch: memory, current_step: "finalize", exit_reason: "workflow_completed" }),
      },
    ];

    const result = await this.runtime.run_task_loop({
      task_id,
      title: `ChannelTask:${args.req.alias}`,
      objective: args.task_with_media,
      channel: args.req.provider,
      chat_id: args.req.message.chat_id,
      nodes,
      max_turns: args.req.max_turns ?? this.config.task_loop_max_turns,
      initial_memory: {
        ...args.req.initial_memory,
        alias: args.req.alias,
        channel: args.req.provider,
        chat_id: args.req.message.chat_id,
        __trigger_message_id: raw_message_id(args.req.message),
      },
      abort_signal: args.req.signal,
    });

    const output_raw = String(result.state.memory?.last_output || "").trim();
    if (result.state.memory?.file_request_waiting === true || output_raw === FILE_WAIT_MARKER) {
      return suppress_result("task", stream, total_tool_count);
    }
    if (result.state.memory?.suppress_final_reply === true) {
      return suppress_result("task", stream, total_tool_count);
    }
    if (result.state.status === "waiting_approval") {
      this.log_event({
        run_id: args.req.run_id || `task-${now_ms()}`, task_id: task_id, agent_id: args.req.alias,
        provider: args.req.provider, channel: args.req.provider, chat_id: args.req.message.chat_id, source: "inbound",
        phase: "approval", summary: "waiting_approval", payload: { mode: "task", tool_calls_count: total_tool_count },
      });
      // 승인 알림은 approval-notifier가 별도 발송하므로 오케스트레이션 응답은 suppress
      return { ...suppress_result("task", stream, total_tool_count), run_id: args.req.run_id };
    }
    // waiting_user_input / max_turns_reached: HITL 알림은 on_task_change 콜백에서 bus로 발송
    if (result.state.status === "waiting_user_input" || result.state.status === "max_turns_reached") {
      return { ...suppress_result("task", stream, total_tool_count), run_id: args.req.run_id };
    }
    if (result.state.status === "failed" || result.state.status === "cancelled") {
      const reason = result.state.exitReason || result.state.status;
      this.logger.warn("task_loop_terminal", { task_id, status: result.state.status, exit_reason: reason, turns: result.state.currentTurn });
      return error_result("task", stream, `task_${result.state.status}:${reason}`, total_tool_count);
    }

    const output = sanitize_provider_output(output_raw).trim();
    if (!output) return error_result("task", stream, `task_loop_no_output:${result.state.status}`, total_tool_count);

    const err = extract_provider_error(output);
    if (err) return error_result("task", stream, err, total_tool_count);

    return reply_result("task", stream, normalize_agent_reply(output, args.req.alias, args.req.message.sender_id), total_tool_count);
  }

  private _get_renderer(): PersonaMessageRendererLike {
    if (!this._renderer) {
      const cb = this.runtime.get_context_builder();
      this._renderer = new PersonaMessageRenderer({
        get_persona_name: () => cb.get_persona_name(),
        get_heart: () => {
          try {
            const ws = this.deps.workspace || ".";
            for (const p of [join(ws, "templates", "HEART.md"), join(ws, "HEART.md")]) {
              if (existsSync(p)) { const r = readFileSync(p, "utf-8").trim(); if (r) return r; }
            }
          } catch { /* no heart */ }
          return "";
        },
      });
    }
    return this._renderer;
  }

  /** identity 질의에 대한 결정적 응답. executor/provider를 타지 않음. */
  private _build_identity_reply(): string {
    return this._get_renderer().render({ kind: "identity" });
  }

  /** 빈 응답 시 사용자-facing 안전 폴백. 내부 오류 메시지 노출 방지. */
  private _build_safe_fallback_reply(): string {
    return this._get_renderer().render({ kind: "safe_fallback" });
  }

  /** HITL 프롬프트를 renderer 기반으로 생성. renderer 없으면 format_hitl_prompt fallback. */
  private _render_hitl(body: string, type: "choice" | "confirmation" | "question" | "escalation" | "error"): string {
    return this._get_renderer().render({ kind: "hitl_prompt", hitl_type: type, body });
  }

  /** concierge 페르소나 어투를 followup 지시에 포함. */
  private build_persona_followup(concierge_heart: string): string {
    const base = "위 실행 결과를 바탕으로 간결하게 한국어로 답하세요.";
    return concierge_heart ? `[응답 어투] ${concierge_heart}\n\n${base}` : base;
  }

  /** AgentRunResult → OrchestrationResult 변환. native_tool_loop 백엔드 결과를 통합 형식으로 변환. */
  private _convert_agent_result(
    result: AgentRunResult,
    mode: ExecutionMode,
    stream: StreamBuffer,
    req: OrchestrationRequest,
  ): OrchestrationResult {
    if (result.finish_reason === "error") {
      const err_detail = String(result.metadata?.error || "")
        || String(result.content || "").slice(0, 200)
        || "agent_backend_error";
      return error_result(mode, stream, err_detail, result.tool_calls_count);
    }
    if (result.finish_reason === "cancelled") {
      return suppress_result(mode, stream, result.tool_calls_count);
    }
    const content = sanitize_provider_output(String(result.content || "")).trim();
    if (!content) {
      this.logger.warn("native_backend_empty", { mode, tool_calls: result.tool_calls_count });
      return reply_result(mode, stream, this._build_safe_fallback_reply(), result.tool_calls_count);
    }
    // agent 에스컬레이션 감지 (native 백엔드)
    if (mode === "agent") {
      const esc = detect_escalation(content, "agent");
      if (esc) return error_result("agent", stream, esc, result.tool_calls_count);
    }
    const provider_err = extract_provider_error(content);
    if (provider_err) return error_result(mode, stream, provider_err, result.tool_calls_count);
    const usage = _extract_usage(result.usage);
    const reply = normalize_agent_reply(content, req.alias, req.message.sender_id);
    if (!reply) {
      this.logger.warn("native_backend_empty_after_normalize", { mode, tool_calls: result.tool_calls_count });
      return reply_result(mode, stream, this._build_safe_fallback_reply(), result.tool_calls_count);
    }
    const warn = FINISH_REASON_WARNINGS[result.finish_reason];
    const with_warn = warn ? `${reply}\n\n⚠️ ${warn}` : reply;
    const final_reply = mode === "agent" && result.tool_calls_count === 0
      ? append_no_tool_notice(with_warn)
      : with_warn;
    return reply_result(mode, stream, final_reply, result.tool_calls_count, result.parsed_output, usage);
  }

  /** 활성 스킬들의 preferred_providers를 수집 (중복 제거, 순서 유지). */
  private _collect_skill_provider_preferences(skill_names: string[]): string[] {
    const prefs: string[] = [];
    const seen = new Set<string>();
    for (const name of skill_names) {
      const meta = this.runtime.get_context_builder().skills_loader.get_skill_metadata(name);
      if (!meta?.preferred_providers?.length) continue;
      for (const p of meta.preferred_providers) {
        if (!seen.has(p)) { seen.add(p); prefs.push(p); }
      }
    }
    return prefs;
  }

  /** 시스템 프롬프트를 빌드. alias에 대응하는 role skill이 있으면 role persona를 적용하고, 없으면 concierge 힌트를 사용. */
  private async _build_system_prompt(skill_names: string[], provider: string, chat_id: string, tool_categories?: ReadonlySet<string>, alias?: string): Promise<string> {
    const context_builder = this.runtime.get_context_builder();

    // alias에 대응하는 role skill이 있으면 role persona 적용
    const role = alias || "";
    const role_skill = role ? context_builder.skills_loader.get_role_skill(role) : null;
    if (role_skill) {
      return context_builder.build_role_system_prompt(
        role, skill_names, undefined, { channel: provider, chat_id },
      );
    }

    // role skill 없으면 기본 시스템 프롬프트 + concierge 힌트
    const system = await context_builder.build_system_prompt(
      skill_names, undefined, { channel: provider, chat_id }, tool_categories,
    );
    const concierge_skill = context_builder.skills_loader.get_role_skill("concierge");
    const active_role_hint = concierge_skill?.heart
      ? `\n\n# Active Role: concierge\n${concierge_skill.heart}`
      : "";
    return `${system}${active_role_hint}`;
  }

  /** task execute 노드에서 네이티브 백엔드로 실행 시도. 성공 시 AgentRunResult, 불가 시 null. */
  private async _try_native_task_execute(
    args: RunExecutionArgs & { media: string[] },
    stream: StreamBuffer,
    task_tool_ctx: ToolExecutionContext,
    task_id: string,
    _objective: string,
    seed_prompt: string,
    resume_session?: AgentSession,
  ): Promise<AgentRunResult | null> {
    if (!this.agent_backends) return null;
    const backend = this.agent_backends.resolve_for_mode("task", args.skill_provider_prefs)
      ?? this.agent_backends.resolve_backend(args.executor);
    if (!backend?.native_tool_loop) return null;

    try {
      const system = args.system_base;
      const caps = backend.capabilities;
      return await this.agent_backends.run(backend.id, {
        task: seed_prompt,
        task_id: `task:${task_id}`,
        system_prompt: `${system}\n\n${this._build_overlay("agent")}`,
        tools: args.tool_definitions as ToolSchema[],
        tool_executors: this.runtime.get_tool_executors(),
        runtime_policy: args.runtime_policy,
        max_tokens: 1800,
        temperature: 0.3,
        max_turns: this.config.agent_loop_max_turns,
        effort: "high",
        ...(caps.thinking ? { enable_thinking: true, max_thinking_tokens: 16000 } : {}),
        hooks: this._hooks_for(stream, args, backend.id, task_tool_ctx.task_id),
        abort_signal: args.req.signal,
        cwd: this.deps.workspace,
        mcp_server_configs: this.get_mcp_configs?.() ?? undefined,
        tool_context: task_tool_ctx,
        ...(resume_session ? { resume_session } : {}),
        ...(args.req.register_send_input ? { register_send_input: args.req.register_send_input } : {}),
        wait_for_input_ms: 30_000,
      });
    } catch (e) {
      const msg = error_message(e);
      this.logger.warn("native_tool_loop task_execute error, falling back to legacy", { error: msg });
      return null;
    }
  }

  private async seal_text(provider: ChannelProvider, chat_id: string, raw: string): Promise<string> {
    if (!raw.trim()) return "";
    try {
      const sealed = await seal_inbound_sensitive_text(raw, { provider, chat_id, vault: this.vault });
      return sealed.text;
    } catch {
      return redact_sensitive_text(raw).text;
    }
  }

  private async seal_list(provider: ChannelProvider, chat_id: string, values: string[]): Promise<string[]> {
    const tasks = values
      .map((v) => String(v || "").trim())
      .filter(Boolean)
      .map(async (raw) => {
        if (is_local_reference(raw)) return raw;
        const sealed = await this.seal_text(provider, chat_id, raw);
        return sealed.trim() || null;
      });
    return (await Promise.all(tasks)).filter((v): v is string => v !== null);
  }

  private async inspect_secrets(inputs: string[]): Promise<{ ok: boolean; missing_keys: string[]; invalid_ciphertexts: string[] }> {
    const filtered = inputs.filter((t) => t.trim());
    const reports = await Promise.all(filtered.map((text) => this.vault.inspect_secret_references(text)));
    const missing = new Set<string>();
    const invalid = new Set<string>();
    for (const report of reports) {
      for (const k of report.missing_keys || []) { const n = String(k).trim(); if (n) missing.add(n); }
      for (const t of report.invalid_ciphertexts || []) { const v = String(t).trim(); if (v) invalid.add(v); }
    }
    return { ok: missing.size === 0 && invalid.size === 0, missing_keys: [...missing], invalid_ciphertexts: [...invalid] };
  }

  /** 추천 스킬들의 메타데이터에서 요구 도구 이름을 수집. */
  private collect_skill_tool_names(skill_names: string[]): string[] {
    const out = new Set<string>();
    for (const name of skill_names) {
      const meta = this.runtime.get_skill_metadata(name);
      if (meta) for (const t of meta.tools) out.add(t);
    }
    return [...out];
  }


  private resolve_context_skills(task: string, base: string[]): string[] {
    const out = new Set<string>(base.filter(Boolean));
    for (const s of this.runtime.recommend_skills(task, 8)) {
      const name = String(s || "").trim();
      if (name) out.add(name);
    }
    return [...out];
  }

  /** 재개된 Task loop를 이어서 실행. */
  private async continue_task_loop(
    req: OrchestrationRequest,
    task: import("../contracts.js").TaskState,
    task_with_media: string,
    media: string[],
  ): Promise<OrchestrationResult> {
    const stream = new StreamBuffer();
    const always_skills = this.runtime.get_always_skills();
    const skill_names = this.resolve_context_skills(task_with_media, always_skills);
    const runtime_policy = this.policy_resolver.resolve(task_with_media, media);
    const all_tool_definitions = this.runtime.get_tool_definitions();
    const tool_ctx = build_tool_context(req, task.taskId);
    const executor = resolve_executor_provider(this.config.executor_provider, this._caps());
    const system_base = await this._build_system_prompt(skill_names, req.provider, req.message.chat_id, undefined, req.alias);
    emit_execution_info(stream, req.on_stream, "task (재개)", executor, this.logger);
    let total_tool_count = 0;

    // ProcessTracker에 재개된 task를 연결
    if (req.run_id) {
      this.process_tracker?.set_mode(req.run_id, "task");
      this.process_tracker?.set_executor(req.run_id, executor);
      this.process_tracker?.link_task(req.run_id, task.taskId);
    }

    const user_input = String(task.memory.__user_input || task_with_media);
    const history_lines = req.session_history.slice(-8).map((r) => `[${r.role}] ${r.content}`);
    const context_block = build_context_message(user_input, history_lines);

    // 재개 시 이전 SDK 세션 조회 → resume 지원 백엔드에서 대화 이력 유지
    const prior_session = this.agent_backends?.get_session_store()?.find_by_task(`task:${task.taskId}`) ?? undefined;

    const nodes: TaskNode[] = [
      {
        id: "execute",
        run: async ({ task_state, memory }) => {
          const base_objective = task_state.objective || String(memory.objective || task_with_media);
          const objective = memory.__user_input
            ? `${base_objective}\n\n[사용자 응답] ${String(memory.__user_input)}`
            : base_objective;

          // native backend 우선
          const skill_provider_prefs = this._collect_skill_provider_preferences(skill_names);
          const native_result = await this._try_native_task_execute(
            { req, executor, task_with_media, media, context_block, skill_names, system_base, runtime_policy, tool_definitions: all_tool_definitions, tool_ctx, skill_provider_prefs, request_scope: inbound_scope_id(req.message) },
            stream, tool_ctx, task.taskId, objective, context_block,
            prior_session,
          );
          if (native_result) {
            flush_remaining(stream, req.on_stream);
            const final = sanitize_provider_output(String(native_result.content || "")).trim();
            total_tool_count += native_result.tool_calls_count;
            const clear_patch = { ...memory, last_output: final, __user_input: undefined };
            if (native_result.finish_reason === "cancelled") {
              return { status: "completed" as const, memory_patch: { ...clear_patch, suppress_final_reply: true }, current_step: "execute", exit_reason: "cancelled" };
            }
            if (native_result.finish_reason === "approval_required") {
              return { status: "waiting_approval" as const, memory_patch: clear_patch, current_step: "execute", exit_reason: "waiting_approval" };
            }
            if (final.includes("__request_user_choice__")) {
              return { status: "waiting_user_input" as const, memory_patch: clear_patch, current_step: "execute", exit_reason: "waiting_user_input" };
            }
            return { status: "completed" as const, memory_patch: clear_patch, current_step: "execute", exit_reason: "workflow_completed" };
          }

          // legacy headless 경로
          const state: ToolCallState = { suppress: false, file_requested: false, done_sent: false, tool_count: 0 };
          const resumed_loop_id = `resumed-${now_ms()}-${short_id(8)}`;
          if (req.run_id) this.process_tracker?.link_loop(req.run_id, resumed_loop_id);
          const response = await this.runtime.run_agent_loop({
            loop_id: resumed_loop_id,
            agent_id: req.alias,
            objective,
            context_builder: this.runtime.get_context_builder(),
            providers: this.providers,
            tools: all_tool_definitions,
            provider_id: executor,
            runtime_policy,
            current_message: `${this._build_overlay("agent")}\n\n${context_block}`,
            history_days: [],
            skill_names,
            media,
            channel: req.provider,
            chat_id: req.message.chat_id,
            max_turns: this.config.agent_loop_max_turns,
            model: undefined,
            max_tokens: 1800,
            temperature: 0.3,
            abort_signal: req.signal,
            on_stream: create_stream_handler(this.streaming_cfg, stream, req.on_stream),
            check_should_continue: async () => false,
            on_tool_calls: create_tool_call_handler(this.tool_deps,tool_ctx, state, {
              buffer: stream, on_stream: req.on_stream, on_tool_block: req.on_tool_block,
              on_tool_event: (e) => this.session_cd.observe(e),
              log_ctx: req.run_id ? { run_id: req.run_id, agent_id: String(executor), provider: req.provider, chat_id: req.message.chat_id } : undefined,
            }),
            compaction_flush: this.build_compaction_flush(),
          });

          flush_remaining(stream, req.on_stream);
          const final = sanitize_provider_output(String(response.final_content || "")).trim();
          total_tool_count += state.tool_count;

          const clear_patch = { ...memory, last_output: final, __user_input: undefined };

          if (state.done_sent) {
            return { status: "completed" as const, memory_patch: { ...clear_patch, suppress_final_reply: true }, current_step: "execute", exit_reason: "message_done_sent" };
          }
          if (final.includes("approval_required")) {
            return { status: "waiting_approval" as const, memory_patch: clear_patch, current_step: "execute", exit_reason: "waiting_approval" };
          }
          if (final.includes("__request_user_choice__")) {
            return { status: "waiting_user_input" as const, memory_patch: clear_patch, current_step: "execute", exit_reason: "waiting_user_input" };
          }
          return { status: "completed" as const, memory_patch: clear_patch, current_step: "execute", exit_reason: "workflow_completed" };
        },
      },
    ];

    const result = await this.runtime.run_task_loop({
      task_id: task.taskId,
      title: task.title,
      objective: task.objective || String(task.memory.objective || task_with_media),
      channel: task.channel || req.provider,
      chat_id: task.chatId || req.message.chat_id,
      nodes,
      max_turns: this.config.task_loop_max_turns,
      abort_signal: req.signal,
    });

    const output_raw = String(result.state.memory?.last_output || "").trim();
    if (result.state.memory?.suppress_final_reply === true) {
      return { ...suppress_result("task", stream, total_tool_count), run_id: req.run_id };
    }
    if (result.state.status === "waiting_approval") {
      this.log_event({
        run_id: req.run_id || `resume-${now_ms()}`, task_id: task.taskId, agent_id: req.alias,
        provider: req.provider, channel: req.provider, chat_id: req.message.chat_id, source: "inbound",
        phase: "approval", summary: "waiting_approval (resume)", payload: { mode: "task", tool_calls_count: total_tool_count },
      });
      return { ...suppress_result("task", stream, total_tool_count), run_id: req.run_id };
    }
    // waiting_user_input / max_turns_reached: HITL 알림은 on_task_change 콜백에서 bus로 발송
    if (result.state.status === "waiting_user_input" || result.state.status === "max_turns_reached") {
      return { ...suppress_result("task", stream, total_tool_count), run_id: req.run_id };
    }
    if (result.state.status === "failed" || result.state.status === "cancelled") {
      const reason = result.state.exitReason || result.state.status;
      this.logger.warn("resume_task_terminal", { task_id: task.taskId, status: result.state.status, exit_reason: reason, turns: result.state.currentTurn });
      return { ...error_result("task", stream, `task_${result.state.status}:${reason}`, total_tool_count), run_id: req.run_id };
    }

    const output = sanitize_provider_output(output_raw).trim();
    if (!output) return { ...error_result("task", stream, `resume_task_no_output:${result.state.status}`, total_tool_count), run_id: req.run_id };
    return { ...reply_result("task", stream, normalize_agent_reply(output, req.alias, req.message.sender_id), total_tool_count), run_id: req.run_id };
  }

  /** phase 모드: Phase Loop Runner에 위임. */
  private async run_phase_loop(req: OrchestrationRequest, task_with_media: string, workflow_hint?: string, node_categories?: string[]): Promise<OrchestrationResult> {
    const { run_phase_loop: exec } = await import("../agent/phase-loop-runner.js");
    const { load_workflow_templates, load_workflow_template, substitute_variables } = await import("./workflow-loader.js");
    if (!this.deps.workspace) throw new Error("workspace is required for run_phase_loop");
    const workspace = this.deps.workspace;
    const store = this.deps.phase_workflow_store;
    const subagents = this.deps.subagents;
    if (!subagents || !store) {
      return error_result("phase", null, "phase_loop_deps_not_configured");
    }

    // 분류기가 workflow_id를 힌트로 전달했으면 해당 템플릿 로드
    const hint_id = workflow_hint;

    let template: import("../agent/phase-loop.types.js").WorkflowDefinition | null = null;
    if (hint_id) {
      template = load_workflow_template(workspace, hint_id);
    }
    if (!template) {
      // 키워드 매칭: 사용자 메시지에 포함된 키워드로 템플릿 탐색
      const templates = load_workflow_templates(workspace);
      const lower = task_with_media.toLowerCase();
      template = templates.find((t) =>
        lower.includes(t.title.toLowerCase()) ||
        t.title.toLowerCase().split(/\s+/).some((word) => word.length > 2 && lower.includes(word)),
      ) || null;
    }
    if (!template) {
      // 동적 워크플로우 생성: 오케스트레이터 LLM에게 워크플로우 설계 요청
      const dynamic = await this.generate_dynamic_workflow(task_with_media, workspace);
      if (!dynamic) {
        return error_result("phase", null, "no_matching_workflow_template");
      }
      // 동적 생성 워크플로우는 사용자 확인 후 실행 (비용 통제)
      const preview = this.format_workflow_preview(dynamic);
      const workflow_id = `wf-${short_id(12)}`;
      // 대기 상태로 저장 → 대시보드에서 승인 후 실행
      if (store) {
        store.upsert({
          workflow_id, title: dynamic.title, objective: task_with_media,
          channel: req.provider, chat_id: req.message.chat_id,
          status: "waiting_user_input", current_phase: 0, phases: [],
          memory: { origin: { channel: req.provider, chat_id: req.message.chat_id, sender_id: req.message.sender_id } },
          created_at: now_iso(), updated_at: now_iso(),
          definition: dynamic,
        }).catch((e) => this.logger.error("workflow_upsert_failed", { workflow_id, error: error_message(e) }));
      }
      return { reply: preview, mode: "phase", tool_calls_count: 0, streamed: false, run_id: req.run_id };
    }

    const origin = { channel: req.provider, chat_id: req.message.chat_id, sender_id: req.message.sender_id };
    const definition = substitute_variables(template, {
      // 워크플로우 YAML variables 섹션 (기본값)
      ...(template.variables || {}),
      // 런타임 변수 (override)
      objective: task_with_media,
      channel: req.provider,
      origin_channel: origin.channel,
      origin_chat_id: origin.chat_id,
      origin_sender_id: origin.sender_id,
    });
    const workflow_id = `wf-${short_id(12)}`;

    // ProcessTracker 연결
    if (req.run_id) {
      this.process_tracker?.link_workflow(req.run_id, workflow_id);
    }

    const bus = this.deps.bus;
    const channel_callbacks = bus ? this.build_phase_channel_callbacks(bus, workflow_id, req.provider, req.message.chat_id) : {};

    const result = await exec({
      workflow_id,
      title: definition.title,
      objective: task_with_media,
      channel: req.provider,
      chat_id: req.message.chat_id,
      phases: definition.phases,
      nodes: definition.nodes,
      workspace,
      initial_memory: { origin, ...(node_categories?.length ? { node_categories } : {}) },
      abort_signal: req.signal,
      invoke_tool: (tool_id, params, ctx) => this.runtime.execute_tool(tool_id, params, ctx ? { channel: ctx.channel, chat_id: ctx.chat_id, sender_id: ctx.sender_id, task_id: ctx.workflow_id } : undefined),
      ...channel_callbacks,
      on_phase_change: (state) => {
        req.on_progress?.({ task_id: workflow_id, step: state.current_phase + 1, total_steps: state.phases.length, description: `phase ${state.current_phase + 1}/${state.phases.length}`, provider: req.provider, chat_id: req.message.chat_id, at: now_iso() });
      },
    }, {
      subagents,
      store,
      logger: this.logger,
      load_template: (name) => load_workflow_template(workspace, name),
      providers: this.deps.providers,
      decision_service: this.deps.decision_service,
      promise_service: this.deps.promise_service,
      embed: this.deps.embed,
      vector_store: this.deps.vector_store,
      oauth_fetch: this.deps.oauth_fetch,
      get_webhook_data: this.deps.get_webhook_data,
      wait_kanban_event: this.deps.wait_kanban_event,
      create_task: this.deps.create_task,
      query_db: this.deps.query_db,
      on_event: (event) => {
        this.deps.get_sse_broadcaster?.()?.broadcast_workflow_event(event);
        req.on_agent_event?.({ type: "content_delta", source: { backend: "phase_loop", task_id: workflow_id }, at: now_iso(), text: `[phase] ${event.type}` });
      },
    });
    if (result.status === "completed") {
      return { reply: `워크플로우 \`${definition.title}\` 완료.\n\n${this.format_phase_summary(result)}`, mode: "phase", tool_calls_count: 0, streamed: false, run_id: req.run_id };
    }
    if (result.status === "waiting_user_input") {
      const pending_phase = result.phases.find((p) => p.pending_user_input);
      if (pending_phase) {
        // [ASK_USER]: 에이전트가 명시적으로 질문한 경우
        const last_agent_result = pending_phase.agents.filter((a) => a.result).pop()?.result || "";
        const context = `워크플로우 \`${definition.title}\` → **${pending_phase.phase_id}**\n\n${last_agent_result.slice(0, 500)}`;
        return { reply: this._render_hitl(context, "question"), mode: "phase", tool_calls_count: 0, streamed: false, run_id: req.run_id };
      }
      // escalation: critic 반복 실패로 사용자 판단 필요
      const failed_phase = result.phases.find((p) => p.critic && !p.critic.approved);
      const critic_review = failed_phase?.critic?.review || "";
      const agent_output = failed_phase?.agents.filter((a) => a.result).pop()?.result || "";
      const context = [
        `워크플로우 \`${definition.title}\` → **${failed_phase?.phase_id || "단계"}**`,
        "",
        agent_output ? `**에이전트 결과:**\n${agent_output.slice(0, 400)}` : "",
        critic_review ? `**검토 의견:**\n${critic_review.slice(0, 300)}` : "",
      ].filter(Boolean).join("\n\n");
      return { reply: this._render_hitl(context, "escalation"), mode: "phase", tool_calls_count: 0, streamed: false, run_id: req.run_id };
    }
    const phase_error = result.error || result.status;
    this.logger.warn("phase_loop_terminal", { workflow_id, status: result.status, error: phase_error });
    return { reply: null, error: `phase_${result.status}:${phase_error}`, mode: "phase", tool_calls_count: 0, streamed: false, run_id: req.run_id };
  }

  /** 동적 워크플로우 생성: 오케스트레이터 LLM에게 워크플로우 구조 설계 요청. */
  private async generate_dynamic_workflow(
    objective: string,
    _workspace: string,
  ): Promise<import("../agent/phase-loop.types.js").WorkflowDefinition | null> {
    try {
      const { get_agent_role_presets } = await import("../agent/node-presets.js");
      const role_presets = get_agent_role_presets();
      const preset_catalog = role_presets.map((p) =>
        `  - preset_id: "${p.preset_id}" (${p.label}): ${p.description}`,
      ).join("\n");

      const planner_prompt = [
        "Design a multi-agent workflow for the following objective.",
        `Objective: "${objective}"`,
        "",
        "## Available Agent Role Presets",
        "Use these preset_ids when they match the needed role. The preset provides system_prompt and optimal settings automatically.",
        preset_catalog,
        "",
        "Constraints:",
        "- Maximum 3 phases",
        "- Maximum 4 agents per phase",
        "- Each agent needs: agent_id (snake_case), role, label, backend (use \"openrouter\")",
        "- If a preset matches the role, add preset_id to the agent definition (system_prompt will be auto-filled)",
        "- If no preset matches, provide a custom system_prompt",
        "- Add a critic to each phase with gate=true",
        "",
        "Return ONLY valid JSON matching this schema:",
        '{ "title": string, "objective": string, "phases": [{ "phase_id": string, "title": string, "agents": [{ "agent_id": string, "role": string, "label": string, "backend": "openrouter", "preset_id"?: string, "system_prompt"?: string }], "critic": { "backend": "openrouter", "system_prompt": string, "gate": true } }] }',
      ].join("\n");

      const llm_response = await this.providers.run_orchestrator({
        messages: [{ role: "user", content: planner_prompt }],
        max_tokens: 4096,
        temperature: 0.3,
      });
      const response = llm_response?.content;
      if (!response) return null;

      const json_match = response.match(/\{[\s\S]*"phases"[\s\S]*\}/);
      if (!json_match) return null;

      const raw = JSON.parse(json_match[0]) as Record<string, unknown>;
      if (!raw.title || !Array.isArray(raw.phases)) return null;

      return raw as unknown as import("../agent/phase-loop.types.js").WorkflowDefinition;
    } catch (err) {
      this.logger.warn("dynamic_workflow_generation_failed", { error: error_message(err) });
      return null;
    }
  }

  /** 동적 생성 워크플로우 미리보기 텍스트. */
  private format_workflow_preview(def: import("../agent/phase-loop.types.js").WorkflowDefinition): string {
    const lines = [`다음 워크플로우를 생성했습니다:\n`];
    for (let i = 0; i < def.phases.length; i++) {
      const p = def.phases[i];
      const critic_note = p.critic ? " + critic" : "";
      lines.push(`**Phase ${i + 1}: ${p.title}** (${p.agents.length} agents${critic_note})`);
      for (const a of p.agents) {
        lines.push(`  - ${a.label}: ${a.system_prompt.slice(0, 80)}`);
      }
    }
    lines.push(`\n대시보드에서 워크플로우를 승인하거나 수정하세요.`);
    return lines.join("\n");
  }

  /** Phase Loop 내 interaction 노드용 채널 콜백 빌더. */
  private build_phase_channel_callbacks(
    bus: import("../bus/types.js").MessageBusLike,
    workflow_id: string,
    origin_channel: string,
    origin_chat_id: string,
  ) {
    const logger = this.logger;

    const send_message: import("../agent/phase-loop.types.js").PhaseLoopRunOptions["send_message"] = async (req) => {
      const channel = req.target === "origin" ? origin_channel : (req.channel || origin_channel);
      const chat_id = req.target === "origin" ? origin_chat_id : (req.chat_id || origin_chat_id);
      const msg_id = `wf-msg-${short_id(8)}`;
      try {
        await bus.publish_outbound({
          id: msg_id, provider: channel, channel,
          sender_id: "system", chat_id, content: req.content,
          at: now_iso(),
          metadata: { workflow_id, type: "workflow_notification", ...(req.structured ? { structured: req.structured } : {}) },
        });
        return { ok: true, message_id: msg_id };
      } catch (e) {
        logger.error("workflow_send_message_failed", { workflow_id, error: error_message(e) });
        return { ok: false };
      }
    };

    const hitl = this.hitl_store;
    const ask_channel: import("../agent/phase-loop.types.js").PhaseLoopRunOptions["ask_channel"] = (req, timeout_ms) => {
      const channel = req.target === "origin" ? origin_channel : (req.channel || origin_channel);
      const chat_id = req.target === "origin" ? origin_chat_id : (req.chat_id || origin_chat_id);

      bus.publish_outbound({
        id: `wf-ask-${short_id(8)}`, provider: channel, channel,
        sender_id: "system", chat_id, content: req.content,
        at: now_iso(),
        metadata: { workflow_id, type: "workflow_ask_channel", ...(req.structured ? { structured: req.structured } : {}) },
      }).catch((e) => logger.error("workflow_ask_channel_send_failed", { workflow_id, error: error_message(e) }));

      return new Promise<import("../agent/phase-loop.types.js").ChannelResponse>((resolve) => {
        const timer = setTimeout(() => {
          hitl.delete(workflow_id);
          resolve({ response: "", responded_at: now_iso(), timed_out: true });
        }, timeout_ms);

        hitl.set(workflow_id, {
          resolve: (content: string) => {
            clearTimeout(timer);
            resolve({ response: content, responded_by: { channel, chat_id }, responded_at: now_iso(), timed_out: false });
          },
          chat_id,
        });
      });
    };

    return { send_message, ask_channel };
  }

  private format_phase_summary(result: import("../agent/phase-loop.types.js").PhaseLoopRunResult): string {
    const lines: string[] = [];

    // Phase 기반 요약
    for (const phase of result.phases) {
      lines.push(`**${phase.title}** (${phase.status})`);
      for (const agent of phase.agents) {
        const icon = agent.status === "completed" ? "o" : agent.status === "failed" ? "x" : "-";
        lines.push(`  ${icon} ${agent.label}: ${(agent.result || agent.error || "").slice(0, 200)}`);
      }
      if (phase.critic?.review) {
        lines.push(`  Critic: ${phase.critic.approved ? "Approved" : "Rejected"} — ${phase.critic.review.slice(0, 200)}`);
      }
    }

    // nodes-only 워크플로우: memory에서 마지막 노드 결과 추출
    if (lines.length === 0 && result.memory) {
      const mem = result.memory;
      const keys = Object.keys(mem).filter((k) => k !== "origin" && k !== "node_categories");
      const last_key = keys[keys.length - 1];
      if (last_key) {
        const val = mem[last_key];
        const text = typeof val === "string" ? val : JSON.stringify(val);
        lines.push(text.slice(0, 500));
      }
    }

    return lines.join("\n");
  }
}

function build_tool_context(req: OrchestrationRequest, task_id: string): ToolExecutionContext {
  return {
    task_id,
    signal: req.signal,
    channel: req.provider,
    chat_id: req.message.chat_id,
    sender_id: req.message.sender_id,
    reply_to: resolve_reply_to(req.provider, req.message) || undefined,
  };
}

function error_result(mode: ExecutionMode, stream: StreamBuffer | null, error: string, tool_calls_count = 0): OrchestrationResult {
  return { reply: null, error, mode, tool_calls_count, streamed: stream?.has_streamed() ?? false, stream_full_content: stream?.get_full_content() };
}

function suppress_result(mode: ExecutionMode, stream: StreamBuffer, tool_calls_count = 0): OrchestrationResult {
  return { reply: null, suppress_reply: true, mode, tool_calls_count, streamed: stream.has_streamed(), stream_full_content: stream.get_full_content() };
}

function reply_result(mode: ExecutionMode, stream: StreamBuffer, reply: string | null, tool_calls_count = 0, parsed_output?: unknown, usage?: import("./types.js").ResultUsage): OrchestrationResult {
  return { reply, mode, tool_calls_count, streamed: stream.has_streamed(), stream_full_content: stream.get_full_content(), parsed_output, usage };
}

/** agent 모드에서 도구를 한 번도 사용하지 않은 경우 응답 끝에 완료 안내를 추가. */
export type HitlType = "choice" | "confirmation" | "question" | "escalation" | "error";

/** HITL 대기 상태를 채널 사용자에게 명확히 알리는 프롬프트. */
export function format_hitl_prompt(agent_prompt: string, task_id: string, type: HitlType = "choice"): string {
  const cleaned = (agent_prompt || "")
    .replace(/__request_user_choice__/g, "")
    .replace(/\[ASK_USER\]/g, "")
    .replace(/^ask_user_sent:\S+$/gm, "")
    .replace(/^question:\s.+$/gm, "")
    .trim();
  const body = cleaned || "추가 정보가 필요합니다.";
  const guide = HITL_GUIDE[type];
  return [
    guide.header,
    "",
    body,
    "",
    guide.instruction,
    "",
    "_이 메시지에 답장하면 작업이 자동으로 재개됩니다._",
  ].join("\n");
}

const HITL_GUIDE: Record<HitlType, { header: string; instruction: string }> = {
  choice: {
    header: "💬 **선택 요청**",
    instruction: "위 선택지 중 하나를 골라 답장해주세요.",
  },
  confirmation: {
    header: "💬 **확인 요청**",
    instruction: "`예` 또는 `아니오`로 답장해주세요.",
  },
  question: {
    header: "💬 **질문**",
    instruction: "질문에 대한 답변을 답장해주세요.",
  },
  escalation: {
    header: "⚠️ **판단 필요**",
    instruction: [
      "다음 중 하나를 답장해주세요:",
      "• 구체적인 지시사항을 입력하면 해당 내용으로 재시도합니다",
      "• `계속` — 현재 결과를 수용하고 다음 단계로 진행",
      "• `취소` — 워크플로우를 중단합니다",
    ].join("\n"),
  },
  error: {
    header: "❌ **작업 실패**",
    instruction: [
      "다음 중 하나를 답장해주세요:",
      "• 추가 정보나 수정 지시를 입력하면 해당 내용을 포함하여 재시도합니다",
      "• `재시도` — 동일 조건으로 다시 실행합니다",
      "• `취소` — 작업을 종료합니다",
    ].join("\n"),
  },
};

/** 에이전트 출력에서 HITL 유형을 추론. */
export function detect_hitl_type(prompt: string): HitlType {
  if (!prompt) return "question";
  const lower = prompt.toLowerCase();
  // 확인 요청: yes/no, 예/아니오 패턴
  if (/진행할까요|계속할까요|실행할까요|괜찮을까요|할까요\?|맞나요\?|맞습니까\?/.test(prompt)
    || /\b(yes\s*\/\s*no|y\s*\/\s*n)\b/i.test(prompt)) {
    return "confirmation";
  }
  // 번호 목록 (1. / 1) / ① 등) 또는 불릿 목록 (- / • / * )이 2개 이상이면 선택지
  const numbered = prompt.match(/(?:^|\n)\s*(?:\d+[.)]\s|[①-⑳]\s|[-•*]\s)/g);
  if (numbered && numbered.length >= 2) return "choice";
  return "question";
}

function append_no_tool_notice(reply: string): string {
  return `${reply}\n\n_(작업이 완료되었습니다. 추가 요청이 있으면 말씀해주세요.)_`;
}

function _extract_usage(raw: Record<string, unknown> | undefined): import("./types.js").ResultUsage | undefined {
  if (!raw) return undefined;
  const prompt = Number(raw.prompt_tokens || 0);
  const completion = Number(raw.completion_tokens || 0);
  const total = Number(raw.total_tokens || 0);
  const cost = Number(raw.total_cost_usd || 0);
  if (!prompt && !completion && !total && !cost) return undefined;
  return {
    ...(prompt ? { prompt_tokens: prompt } : {}),
    ...(completion ? { completion_tokens: completion } : {}),
    ...(total ? { total_tokens: total } : {}),
    ...(cost ? { total_cost_usd: cost } : {}),
  };
}

function compose_task_with_media(task: string, media: string[]): string {
  if (!media.length) return task;
  const lines = media.map((m, i) => `${i + 1}. ${m}`);
  return [
    task || "첨부 파일을 분석하세요.",
    "", "[ATTACHED_FILES]", ...lines, "",
    "요구사항:", "- 첨부 파일을 우선 분석하고 핵심 결과를 요약할 것", "- 표/코드/로그가 포함되면 핵심만 구조화해 보고할 것",
  ].join("\n");
}

function build_context_message(task_with_media: string, history_lines: string[]): string {
  return [
    `[CURRENT_REQUEST]\n${task_with_media}`,
    history_lines.length > 0 ? ["[REFERENCE_RECENT_CONTEXT]", ...history_lines].join("\n") : "",
    "중요: 실행 대상은 CURRENT_REQUEST 하나입니다. REFERENCE 문맥은 참고용이며 재실행 지시가 아닙니다.",
  ].filter(Boolean).join("\n\n");
}

export function resolve_reply_to(provider: ChannelProvider, message: InboundMessage): string {
  const meta = (message.metadata || {}) as Record<string, unknown>;
  if (provider === "slack") {
    const thread = String(message.thread_id || "").trim();
    if (thread) return thread;
    return String(meta.message_id || message.id || "").trim();
  }
  if (provider === "telegram") return "";
  return String(meta.message_id || message.id || "").trim();
}

/** trigger_message_id 역조회용 — 정규화 없이 원본 메시지 ID 반환. */
function raw_message_id(message: InboundMessage): string {
  const meta = (message.metadata || {}) as Record<string, unknown>;
  return String(meta.message_id || message.id || "").trim();
}

const RE_SCOPE_INVALID = /[^a-zA-Z0-9._-]+/g;
const RE_MULTI_DASH = /-+/g;

function inbound_scope_id(message: InboundMessage): string {
  const meta = (message.metadata || {}) as Record<string, unknown>;
  const raw = String(meta.message_id || message.id || "").trim();
  if (!raw) return `msg-${now_ms()}`;
  RE_SCOPE_INVALID.lastIndex = 0;
  RE_MULTI_DASH.lastIndex = 0;
  return raw.replace(RE_SCOPE_INVALID, "-").replace(RE_MULTI_DASH, "-").slice(0, 96) || `msg-${now_ms()}`;
}
