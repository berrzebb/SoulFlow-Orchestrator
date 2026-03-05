import type { InboundMessage } from "../bus/types.js";
import type { ChannelProvider } from "../channels/types.js";
import type { AgentRuntimeLike } from "../agent/runtime.types.js";
import type { ProviderRegistry } from "../providers/service.js";
import type { ChatMessage, RuntimeExecutionPolicy } from "../providers/types.js";
import type { RuntimePolicyResolver } from "../channels/runtime-policy.js";
import type { SecretVaultService } from "../security/secret-vault.js";
import type { TaskNode } from "../agent/loop.js";
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
import { select_tools_for_request, TOOL_CATEGORIES } from "./tool-selector.js";
import type { AgentBackendRegistry } from "../agent/agent-registry.js";
import type { AgentRunResult, AgentSession } from "../agent/agent.types.js";
import type { ToolSchema } from "../agent/tools/types.js";
import { create_cd_observer } from "../agent/cd-scoring.js";
import type { ProcessTrackerLike } from "./process-tracker.js";
import type { WorkflowEventService, AppendWorkflowEventInput } from "../events/index.js";
import { join } from "node:path";
import { now_iso, now_ms, error_message, short_id } from "../utils/common.js";
// ── 추출 모듈 ──
import {
  ONCE_MODE_OVERLAY, AGENT_MODE_OVERLAY, AGENT_TOOL_NUDGE,
  format_secret_notice,
} from "./prompts.js";
import { FINISH_REASON_WARNINGS } from "../agent/finish-reason-warnings.js";
import { detect_escalation, is_once_escalation } from "./classifier.js";
import { resolve_gateway, type GatewayDecision } from "./gateway.js";
import {
  create_tool_call_handler, type ToolCallState, type ToolCallHandlerDeps,
} from "./tool-call-handler.js";
import {
  build_agent_hooks, create_stream_handler, flush_remaining, emit_execution_info,
  type AgentHooksBuilderDeps,
} from "./agent-hooks-builder.js";

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
  private readonly deps: OrchestrationServiceDeps;
  private readonly session_cd = create_cd_observer();
  private readonly streaming_cfg: { enabled: boolean; interval_ms: number; min_chars: number };
  private readonly hooks_deps: AgentHooksBuilderDeps;
  private readonly tool_deps: ToolCallHandlerDeps;

  constructor(deps: OrchestrationServiceDeps) {
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

  private _caps(): ProviderCapabilities {
    return this.config.provider_caps ?? { chatgpt_available: true, claude_available: false, openrouter_available: false };
  }

  /** 공통 AgentHooks 구성. args.req + stream + backend_id 조합. */
  private _hooks_for(stream: StreamBuffer, args: { req: OrchestrationRequest; runtime_policy: RuntimeExecutionPolicy }, backend_id: string) {
    return build_agent_hooks(this.hooks_deps, {
      buffer: stream, on_stream: args.req.on_stream, runtime_policy: args.runtime_policy,
      channel_context: { channel: args.req.provider, chat_id: String(args.req.message.chat_id || "") },
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

    this.runtime.apply_tool_runtime_context({
      channel: req.provider,
      chat_id: req.message.chat_id,
      reply_to: resolve_reply_to(req.provider, req.message),
    });

    const history_lines = req.session_history.slice(-8).map((r) => `[${r.role}] ${r.content}`);
    const context_block = build_context_message(task_with_media, history_lines);
    const tool_ctx = build_tool_context(req, request_task_id);

    const skill_tool_names = this.collect_skill_tool_names(skill_names);
    const active_tasks_in_chat = this.runtime.list_active_tasks().filter(
      (t) => String(t.memory?.chat_id || "") === String(req.message.chat_id),
    );
    const tool_categories = [...new Set(Object.values(TOOL_CATEGORIES))];
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
      return finalize(await this.run_phase_loop(req, task_with_media, workflow_hint));
    }

    const { tools: tool_definitions } = select_tools_for_request(all_tool_definitions, task_with_media, mode, skill_tool_names);
    const system_base = await this._build_system_prompt(skill_names, req.provider, req.message.chat_id);
    this.logger.info("dispatch", { mode, executor, skills: skill_names, tool_count: tool_definitions.length });

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
      { role: "system", content: `${system_base}\n\n${ONCE_MODE_OVERLAY}` },
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
            hooks: this._hooks_for(stream, args, backend.id),
            abort_signal: args.req.signal,
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
            { role: "user", content: this.build_persona_followup(this.runtime.get_context_builder().skills_loader.get_role_skill("butler")?.heart || "") },
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
            system_prompt: `${system}\n\n${AGENT_MODE_OVERLAY}`,
            tools: args.tool_definitions as ToolSchema[],
            tool_executors: this.runtime.get_tool_executors(),
            runtime_policy: args.runtime_policy,
            max_tokens: 1800,
            temperature: 0.3,
            max_turns: this.config.agent_loop_max_turns,
            effort: "high",
            ...(caps.thinking ? { enable_thinking: true, max_thinking_tokens: 16000 } : {}),
            hooks: this._hooks_for(stream, args, backend.id),
            abort_signal: args.req.signal,
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
      current_message: `${AGENT_MODE_OVERLAY}\n\n${args.context_block}`,
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
    });

    flush_remaining(stream, args.req.on_stream);

    if (state.suppress) return suppress_result("agent", stream, state.tool_count);

    const content = sanitize_provider_output(String(response.final_content || ""));
    if (!content) return error_result("agent", stream, "empty_provider_response", state.tool_count);

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
            current_message: `${AGENT_MODE_OVERLAY}\n\n${seed_prompt}`,
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
      max_turns: this.config.task_loop_max_turns,
      initial_memory: {
        alias: args.req.alias,
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
      return { reply: "승인 대기 상태입니다. 승인 응답 후 같은 작업을 재개합니다.", mode: "task", tool_calls_count: total_tool_count, streamed: stream.has_streamed() };
    }
    if (result.state.status === "waiting_user_input") {
      const prompt_text = sanitize_provider_output(output_raw).trim();
      return { reply: prompt_text || "선택을 기다리고 있습니다.", mode: "task", tool_calls_count: total_tool_count, streamed: stream.has_streamed() };
    }

    const output = sanitize_provider_output(output_raw).trim();
    if (!output) return error_result("task", stream, `task_loop_no_output:${result.state.status}`, total_tool_count);

    const err = extract_provider_error(output);
    if (err) return error_result("task", stream, err, total_tool_count);

    return reply_result("task", stream, normalize_agent_reply(output, args.req.alias, args.req.message.sender_id), total_tool_count);
  }

  /** butler 페르소나 어투를 followup 지시에 포함. */
  private build_persona_followup(butler_heart: string): string {
    const base = "위 실행 결과를 바탕으로 간결하게 한국어로 답하세요.";
    return butler_heart ? `[응답 어투] ${butler_heart}\n\n${base}` : base;
  }

  /** AgentRunResult → OrchestrationResult 변환. native_tool_loop 백엔드 결과를 통합 형식으로 변환. */
  private _convert_agent_result(
    result: AgentRunResult,
    mode: ExecutionMode,
    stream: StreamBuffer,
    req: OrchestrationRequest,
  ): OrchestrationResult {
    if (result.finish_reason === "error") {
      return error_result(mode, stream, String(result.metadata?.error || "agent_backend_error"), result.tool_calls_count);
    }
    if (result.finish_reason === "cancelled") {
      return suppress_result(mode, stream, result.tool_calls_count);
    }
    const content = sanitize_provider_output(String(result.content || "")).trim();
    if (!content) return error_result(mode, stream, "native_backend_empty", result.tool_calls_count);
    const provider_err = extract_provider_error(content);
    if (provider_err) return error_result(mode, stream, provider_err, result.tool_calls_count);
    const usage = _extract_usage(result.usage);
    const reply = normalize_agent_reply(content, req.alias, req.message.sender_id);
    if (!reply) return error_result(mode, stream, "native_backend_empty_after_normalize", result.tool_calls_count);
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

  /** 시스템 프롬프트를 빌드. butler 역할 힌트 포함. */
  private async _build_system_prompt(skill_names: string[], provider: string, chat_id: string): Promise<string> {
    const context_builder = this.runtime.get_context_builder();
    const system = await context_builder.build_system_prompt(
      skill_names, undefined, { channel: provider, chat_id },
    );
    const butler_skill = context_builder.skills_loader.get_role_skill("butler");
    const active_role_hint = butler_skill?.heart
      ? `\n\n# Active Role: butler\n${butler_skill.heart}`
      : "";
    return `${system}${active_role_hint}`;
  }

  /** task execute 노드에서 네이티브 백엔드로 실행 시도. 성공 시 AgentRunResult, 불가 시 null. */
  private async _try_native_task_execute(
    args: RunExecutionArgs & { media: string[] },
    stream: StreamBuffer,
    task_tool_ctx: ToolExecutionContext,
    task_id: string,
    objective: string,
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
        system_prompt: `${system}\n\n${AGENT_MODE_OVERLAY}`,
        tools: args.tool_definitions as ToolSchema[],
        tool_executors: this.runtime.get_tool_executors(),
        runtime_policy: args.runtime_policy,
        max_tokens: 1800,
        temperature: 0.3,
        max_turns: this.config.agent_loop_max_turns,
        effort: "high",
        ...(caps.thinking ? { enable_thinking: true, max_thinking_tokens: 16000 } : {}),
        hooks: this._hooks_for(stream, args, backend.id),
        abort_signal: args.req.signal,
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
    const system_base = await this._build_system_prompt(skill_names, req.provider, req.message.chat_id);
    emit_execution_info(stream, req.on_stream, "task (재개)", executor, this.logger);
    let total_tool_count = 0;

    // ProcessTracker에 재개된 task를 연결
    if (req.run_id) {
      this.process_tracker?.set_mode(req.run_id, "task");
      this.process_tracker?.set_executor(req.run_id, executor);
      this.process_tracker?.link_task(req.run_id, task.taskId);
    }

    this.runtime.apply_tool_runtime_context({
      channel: req.provider,
      chat_id: req.message.chat_id,
      reply_to: resolve_reply_to(req.provider, req.message),
    });

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
            current_message: `${AGENT_MODE_OVERLAY}\n\n${context_block}`,
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
      return { reply: "승인 대기 상태입니다. 승인 응답 후 같은 작업을 재개합니다.", mode: "task", tool_calls_count: total_tool_count, streamed: stream.has_streamed(), run_id: req.run_id };
    }
    if (result.state.status === "waiting_user_input") {
      const prompt_text = sanitize_provider_output(output_raw).trim();
      return { reply: prompt_text || "선택을 기다리고 있습니다.", mode: "task", tool_calls_count: total_tool_count, streamed: stream.has_streamed(), run_id: req.run_id };
    }

    const output = sanitize_provider_output(output_raw).trim();
    if (!output) return { ...error_result("task", stream, `resume_task_no_output:${result.state.status}`, total_tool_count), run_id: req.run_id };
    return { ...reply_result("task", stream, normalize_agent_reply(output, req.alias, req.message.sender_id), total_tool_count), run_id: req.run_id };
  }

  /** phase 모드: Phase Loop Runner에 위임. */
  private async run_phase_loop(req: OrchestrationRequest, task_with_media: string, workflow_hint?: string): Promise<OrchestrationResult> {
    const { run_phase_loop: exec } = await import("../agent/phase-loop-runner.js");
    const { load_workflow_templates, load_workflow_template, substitute_variables } = await import("./workflow-loader.js");
    const workspace = this.deps.workspace || process.cwd();
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
        void store.upsert({
          workflow_id, title: dynamic.title, objective: task_with_media,
          channel: req.provider, chat_id: req.message.chat_id,
          status: "waiting_user_input", current_phase: 0, phases: [],
          memory: {}, created_at: now_iso(), updated_at: now_iso(),
          definition: dynamic,
        });
      }
      return { reply: preview, mode: "phase", tool_calls_count: 0, streamed: false, run_id: req.run_id };
    }

    const definition = substitute_variables(template, { objective: task_with_media, channel: req.provider });
    const workflow_id = `wf-${short_id(12)}`;

    // ProcessTracker 연결
    if (req.run_id) {
      this.process_tracker?.link_workflow(req.run_id, workflow_id);
    }

    const result = await exec({
      workflow_id,
      title: definition.title,
      objective: task_with_media,
      channel: req.provider,
      chat_id: req.message.chat_id,
      phases: definition.phases,
      abort_signal: req.signal,
      on_phase_change: (state) => {
        req.on_progress?.({ task_id: workflow_id, step: state.current_phase + 1, total_steps: state.phases.length, description: `phase ${state.current_phase + 1}/${state.phases.length}`, provider: req.provider, chat_id: req.message.chat_id, at: now_iso() });
      },
    }, {
      subagents,
      store,
      logger: this.logger,
      on_event: (event) => {
        this.deps.get_sse_broadcaster?.()?.broadcast_workflow_event(event);
        req.on_agent_event?.({ type: "content_delta", source: { backend: "phase_loop", task_id: workflow_id }, at: now_iso(), text: `[phase] ${event.type}` });
      },
    });
    const reply = result.status === "completed"
      ? `워크플로우 \`${definition.title}\` 완료.\n\n${this.format_phase_summary(result)}`
      : result.status === "waiting_user_input"
        ? `워크플로우가 사용자 입력을 대기 중입니다. 대시보드에서 확인하세요.\nWorkflow ID: \`${workflow_id}\``
        : `워크플로우 실패: ${result.error || result.status}`;
    return { reply, mode: "phase", tool_calls_count: 0, streamed: false, run_id: req.run_id };
  }

  /** 동적 워크플로우 생성: 오케스트레이터 LLM에게 워크플로우 구조 설계 요청. */
  private async generate_dynamic_workflow(
    objective: string,
    _workspace: string,
  ): Promise<import("../agent/phase-loop.types.js").WorkflowDefinition | null> {
    try {
      const planner_prompt = [
        "Design a multi-agent workflow for the following objective.",
        `Objective: "${objective}"`,
        "",
        "Constraints:",
        "- Maximum 3 phases",
        "- Maximum 4 agents per phase",
        "- Each agent needs: agent_id (snake_case), role, label, backend (use \"openrouter\"), system_prompt",
        "- Add a critic to each phase with gate=true",
        "",
        "Return ONLY valid JSON matching this schema:",
        '{ "title": string, "objective": string, "phases": [{ "phase_id": string, "title": string, "agents": [...], "critic": { "backend": "openrouter", "system_prompt": string, "gate": true } }] }',
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

  private format_phase_summary(result: import("../agent/phase-loop.types.js").PhaseLoopRunResult): string {
    const lines: string[] = [];
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
