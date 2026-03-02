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
  sanitize_stream_chunk,
  normalize_agent_reply,
  extract_provider_error,
} from "../channels/output-sanitizer.js";
import { seal_inbound_sensitive_text } from "../security/inbound-seal.js";
import { redact_sensitive_text } from "../security/sensitive.js";
import { is_local_reference } from "../utils/local-ref.js";
import { resolve_executor_provider, type ExecutorProvider } from "../providers/executor.js";
import { select_tools_for_request } from "./tool-selector.js";
import { create_policy_pre_hook } from "../agent/tools/index.js";
import type { AgentBackendRegistry } from "../agent/agent-registry.js";
import type { AgentEvent, AgentHooks, AgentRunResult, AgentSession } from "../agent/agent.types.js";
import type { ToolSchema } from "../agent/tools/types.js";
import { create_cd_observer, type CDObserver } from "../agent/cd-scoring.js";
import type { ProcessTrackerLike } from "./process-tracker.js";
import type { WorkflowEventService, AppendWorkflowEventInput } from "../events/index.js";
import { now_iso } from "../utils/common.js";

type OrchestratorConfig = {
  executor_provider: ExecutorProvider;
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
};

type ToolCallEntry = { name: string; arguments?: Record<string, unknown> };
type ToolCallState = { suppress: boolean; file_requested?: boolean; done_sent?: boolean; tool_count: number };

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
  private readonly session_cd = create_cd_observer();

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
    const run_id = req.run_id || `orch-${Date.now()}`;

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
    let mode = await this.pick_execution_mode(task_with_media, active_tasks_in_chat);
    const executor = resolve_executor_provider(this.config.executor_provider);

    // inquiry: Phi-4가 "이전 작업 상태 조회 의도"로 분류 → spawn 없이 직접 응답
    if (mode === ("inquiry" as ExecutionMode) && active_tasks_in_chat.length > 0) {
      this.logger.info("inquiry_shortcircuit", { count: active_tasks_in_chat.length, chat_id: req.message.chat_id });
      const session_lookup = (task_id: string) => this.runtime.find_session_by_task(task_id);
      const inquiry_result = { reply: format_active_task_summary(active_tasks_in_chat, session_lookup), mode: "once" as const, tool_calls_count: 0, streamed: false };
      this.log_event({ ...evt_base, phase: "done", summary: "inquiry shortcircuit", payload: { mode: "inquiry", active_count: active_tasks_in_chat.length } });
      return inquiry_result;
    }
    if (mode === ("inquiry" as ExecutionMode)) mode = "once"; // 활성 작업 없으면 once로 fallback

    if (mode !== "once" && !this.providers.supports_tool_loop(executor)) {
      this.logger.info("mode_downgrade", { original: mode, executor, reason: "no_tool_loop" });
      mode = "once";
    }

    const { tools: tool_definitions } = select_tools_for_request(all_tool_definitions, task_with_media, mode, skill_tool_names);
    this.logger.info("dispatch", { mode, executor });

    if (req.run_id) {
      this.process_tracker?.set_mode(req.run_id, mode);
      this.process_tracker?.set_executor(req.run_id, executor);
    }
    this.log_event({ ...evt_base, phase: "progress", summary: `executing: ${mode}`, payload: { mode, executor } });

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

    // once → executor 1회 호출. 에스컬레이션 시 executor 루프로 전환.
    let escalation_error: string | undefined;
    if (mode === "once") {
      const once_result = await this.run_once({
        req, executor, task_with_media, context_block, skill_names,
        runtime_policy, tool_definitions, tool_ctx,
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
        skill_names, runtime_policy, tool_definitions, tool_ctx,
      };
      return loop_mode === "task"
        ? this.run_task_loop(loop_args)
        : this.run_agent_loop({ ...loop_args, history_lines });
    };

    const first = await run_loop(executor);
    if (first.reply || first.suppress_reply) return finalize(first);

    if (executor === "claude_code") {
      const fallback = resolve_executor_provider("chatgpt");
      if (fallback !== executor) {
        this.logger.warn("executor failed, trying fallback", { executor, fallback, error: first.error });
        const second = await run_loop(fallback);
        if (second.reply || second.suppress_reply) return finalize(second);
        return finalize({ ...second, error: second.error || first.error });
      }
    }
    return finalize(first);
  }

  /** executor에게 1회 질의. Phi-4는 분류만 수행하고 실제 응답은 executor가 생성. */
  private async run_once(args: {
    req: OrchestrationRequest;
    executor: ExecutorProvider;
    task_with_media: string;
    context_block: string;
    skill_names: string[];
    runtime_policy: RuntimeExecutionPolicy;
    tool_definitions: Array<Record<string, unknown>>;
    tool_ctx: ToolExecutionContext;
  }): Promise<OrchestrationResult> {
    const stream = new StreamBuffer();
    this.emit_execution_info(stream, args.req.on_stream, "once", args.executor);
    const system_base = await this._build_system_prompt(args.skill_names, args.req.provider, args.req.message.chat_id);
    const messages: ChatMessage[] = [
      { role: "system", content: `${system_base}\n\n${ONCE_MODE_OVERLAY}` },
      { role: "user", content: args.context_block },
    ];

    // native_tool_loop 백엔드: 전체 실행을 위임하고 결과를 변환.
    if (this.agent_backends) {
      const backend = this.agent_backends.resolve_backend(args.executor);
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
            hooks: this._build_agent_hooks(stream, args.req.on_stream, args.runtime_policy, { channel: args.req.provider, chat_id: String(args.req.message.chat_id || "") }, args.req.on_tool_block, backend.id, args.req.on_progress, args.req.run_id, args.req.on_agent_event).hooks,
            abort_signal: args.req.signal,
            mcp_server_configs: this.get_mcp_configs?.() ?? undefined,
            tool_context: args.tool_ctx,
          });
          this.flush_remaining(stream, args.req.on_stream);
          return this._convert_agent_result(result, "once", stream, args.req);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
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
        on_stream: this.create_stream_handler(stream, args.req.on_stream),
      });

      const err = extract_provider_error(String(response.content || ""));
      if (err) return error_result("once", stream, err);

      if (response.has_tool_calls) {
        this.logger.debug("once: tool calls", { count: response.tool_calls.length });
        const tool_state: ToolCallState = { suppress: false, tool_count: 0 };
        const handler = this.create_tool_call_handler(args.tool_ctx, tool_state, {
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
          on_stream: this.create_stream_handler(stream, args.req.on_stream),
        });
        this.flush_remaining(stream, args.req.on_stream);
        const followup_text = sanitize_provider_output(String(followup.content || "")).trim();
        const final_text = followup_text || tool_output;
        return reply_result("once", stream, normalize_agent_reply(final_text, args.req.alias, args.req.message.sender_id), tool_state.tool_count);
      }

      this.flush_remaining(stream, args.req.on_stream);
      const content = sanitize_provider_output(String(response.content || ""));
      const final = content.trim();
      if (!final) return error_result("once", stream, "executor_once_empty");

      const escalation = detect_escalation(final);
      if (escalation) return error_result("once", stream, escalation);

      return reply_result("once", stream, normalize_agent_reply(final, args.req.alias, args.req.message.sender_id), 0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn("run_once error", { error: msg });
      return error_result("once", stream, msg);
    }
  }

  private async run_agent_loop(args: {
    req: OrchestrationRequest;
    executor: ExecutorProvider;
    task_with_media: string;
    media: string[];
    context_block: string;
    skill_names: string[];
    runtime_policy: RuntimeExecutionPolicy;
    tool_definitions: Array<Record<string, unknown>>;
    tool_ctx: ToolExecutionContext;
    history_lines: string[];
  }): Promise<OrchestrationResult> {
    const stream = new StreamBuffer();
    this.emit_execution_info(stream, args.req.on_stream, "agent", args.executor);

    // native backend 우선: 전체 tool loop를 백엔드에 위임
    if (this.agent_backends) {
      const backend = this.agent_backends.resolve_backend(args.executor);
      if (backend?.native_tool_loop) {
        try {
          const system = await this._build_system_prompt(args.skill_names, args.req.provider, args.req.message.chat_id);
          const caps = backend.capabilities;
          const result = await this.agent_backends.run(backend.id, {
            task: args.context_block,
            task_id: `agent:${args.req.provider}:${args.req.message.chat_id}:${args.req.alias}`,
            system_prompt: system,
            tools: args.tool_definitions as ToolSchema[],
            tool_executors: this.runtime.get_tool_executors(),
            runtime_policy: args.runtime_policy,
            max_tokens: 1800,
            temperature: 0.3,
            max_turns: this.config.agent_loop_max_turns,
            effort: "high",
            ...(caps.thinking ? { enable_thinking: true, max_thinking_tokens: 16000 } : {}),
            hooks: this._build_agent_hooks(stream, args.req.on_stream, args.runtime_policy, { channel: args.req.provider, chat_id: String(args.req.message.chat_id || "") }, args.req.on_tool_block, backend.id, args.req.on_progress, args.req.run_id, args.req.on_agent_event).hooks,
            abort_signal: args.req.signal,
            mcp_server_configs: this.get_mcp_configs?.() ?? undefined,
            tool_context: args.tool_ctx,
          });
          this.flush_remaining(stream, args.req.on_stream);
          return this._convert_agent_result(result, "agent", stream, args.req);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          this.logger.warn("native_tool_loop run_agent_loop error, falling back to legacy", { error: msg });
          // fallback: legacy headless 경로
        }
      }
    }

    // legacy headless 경로
    const state: ToolCallState = { suppress: false, tool_count: 0 };

    const loop_id = `loop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
      current_message: args.context_block,
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
      on_stream: this.create_stream_handler(stream, args.req.on_stream),
      check_should_continue: async () => false,
      on_tool_calls: this.create_tool_call_handler(args.tool_ctx, state, {
        buffer: stream, on_stream: args.req.on_stream, on_tool_block: args.req.on_tool_block,
        on_tool_event: (e) => this.session_cd.observe(e),
        log_ctx: args.req.run_id ? { run_id: args.req.run_id, agent_id: String(args.executor), provider: args.req.provider, chat_id: args.req.message.chat_id } : undefined,
      }),
    });

    this.flush_remaining(stream, args.req.on_stream);

    if (state.suppress) return suppress_result("agent", stream, state.tool_count);

    const content = sanitize_provider_output(String(response.final_content || ""));
    if (!content) return error_result("agent", stream, "empty_provider_response", state.tool_count);

    const err = extract_provider_error(content);
    if (err) return error_result("agent", stream, err, state.tool_count);

    return reply_result("agent", stream, normalize_agent_reply(content, args.req.alias, args.req.message.sender_id), state.tool_count);
  }

  private async run_task_loop(args: {
    req: OrchestrationRequest;
    executor: ExecutorProvider;
    task_with_media: string;
    media: string[];
    context_block: string;
    skill_names: string[];
    runtime_policy: RuntimeExecutionPolicy;
    tool_definitions: Array<Record<string, unknown>>;
    tool_ctx: ToolExecutionContext;
  }): Promise<OrchestrationResult> {
    const stream = new StreamBuffer();
    this.emit_execution_info(stream, args.req.on_stream, "task", args.executor);
    const task_id = `task:${args.req.provider}:${args.req.message.chat_id}:${args.req.alias}:${inbound_scope_id(args.req.message)}`.toLowerCase();
    if (args.req.run_id) this.process_tracker?.link_task(args.req.run_id, task_id);
    const FILE_WAIT_MARKER = "__file_request_waiting__";
    let total_tool_count = 0;

    const nodes: TaskNode[] = [
      {
        id: "plan",
        run: async ({ memory }) => ({
          memory_patch: { ...memory, objective: args.task_with_media, seed_prompt: args.context_block, mode: "task_loop" },
          next_step_index: 1,
          current_step: "plan",
        }),
      },
      {
        id: "execute",
        run: async ({ memory }) => {
          const task_tool_ctx: ToolExecutionContext = { ...args.tool_ctx, task_id };
          const objective = String(memory.objective || args.task_with_media);
          const seed_prompt = String(memory.seed_prompt || args.context_block);

          // native backend 우선: 전체 tool loop를 백엔드에 위임
          const native_result = await this._try_native_task_execute(args, stream, task_tool_ctx, task_id, objective, seed_prompt);
          if (native_result) {
            this.flush_remaining(stream, args.req.on_stream);
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

          const nested_loop_id = `nested-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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
            current_message: seed_prompt,
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
            on_stream: this.create_stream_handler(stream, args.req.on_stream),
            check_should_continue: async () => false,
            on_tool_calls: this.create_tool_call_handler(task_tool_ctx, state, {
              buffer: stream, on_stream: args.req.on_stream, on_tool_block: args.req.on_tool_block,
              on_tool_event: (e) => this.session_cd.observe(e),
              log_ctx: args.req.run_id ? { run_id: args.req.run_id, agent_id: String(args.executor), provider: args.req.provider, chat_id: args.req.message.chat_id } : undefined,
            }),
          });

          this.flush_remaining(stream, args.req.on_stream);
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
      nodes,
      max_turns: this.config.task_loop_max_turns,
      initial_memory: { alias: args.req.alias, channel: args.req.provider, chat_id: args.req.message.chat_id },
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
        run_id: args.req.run_id || `task-${Date.now()}`, task_id: task_id, agent_id: args.req.alias,
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

  /** Phi-4에게 실행 모드 분류를 위임. 정규식 사전 필터 없이 항상 LLM 판단. */
  private async pick_execution_mode(
    task: string,
    active_tasks?: import("../contracts.js").TaskState[],
  ): Promise<ExecutionMode> {
    const text = String(task || "").trim();
    if (!text) return "once";
    if (!has_orchestrator(this.providers)) return "once";

    // 활성 작업이 있을 때만 inquiry 모드를 분류 옵션에 추가
    const has_active = active_tasks && active_tasks.length > 0;
    const active_context = has_active
      ? build_active_task_context(active_tasks)
      : "";
    const prompt = has_active
      ? EXECUTION_MODE_CLASSIFY_PROMPT + "\n" + INQUIRY_MODE_ADDENDUM + "\n" + active_context
      : EXECUTION_MODE_CLASSIFY_PROMPT;

    try {
      const response = await this.providers.run_orchestrator({
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: `[REQUEST]\n${text}` },
        ],
        max_tokens: 120,
        temperature: 0,
      });
      const parsed = parse_execution_mode(String(response.content || ""));
      if (parsed) return parsed;
    } catch (e) {
      this.logger.debug("execution mode classify failed", { error: String(e) });
    }

    return "once";
  }

  private create_stream_handler(
    buffer: StreamBuffer,
    on_stream?: (chunk: string) => void,
  ): ((chunk: string) => Promise<void>) | undefined {
    if (!this.config.streaming_enabled || !on_stream) return undefined;

    return async (chunk: string) => {
      const sanitized = sanitize_stream_chunk(String(chunk || ""));
      if (!sanitized) return;

      buffer.append(sanitized);

      if (buffer.should_flush(this.config.streaming_interval_ms, this.config.streaming_min_chars)) {
        const content = buffer.flush();
        if (content) {
          try { on_stream(content); } catch { /* stream callback failure must not break provider loop */ }
        }
      }
    };
  }

  private flush_remaining(buffer: StreamBuffer, on_stream?: (chunk: string) => void): void {
    if (!on_stream) return;
    const content = buffer.flush();
    if (content) {
      try { on_stream(content); } catch { /* stream callback failure must not break orchestration */ }
    }
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
    // 비정상 종료 시 reply 끝에 경고 힌트 추가
    const warn = FINISH_REASON_WARNINGS[result.finish_reason];
    const final_reply = warn ? `${reply}\n\n⚠️ ${warn}` : reply;
    return reply_result(mode, stream, final_reply, result.tool_calls_count, result.parsed_output, usage);
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
    args: {
      req: OrchestrationRequest;
      executor: ExecutorProvider;
      skill_names: string[];
      runtime_policy: RuntimeExecutionPolicy;
      tool_definitions: Array<Record<string, unknown>>;
      tool_ctx: ToolExecutionContext;
      task_with_media: string;
      media: string[];
      context_block: string;
    },
    stream: StreamBuffer,
    task_tool_ctx: ToolExecutionContext,
    task_id: string,
    objective: string,
    seed_prompt: string,
    resume_session?: AgentSession,
  ): Promise<AgentRunResult | null> {
    if (!this.agent_backends) return null;
    const backend = this.agent_backends.resolve_backend(args.executor);
    if (!backend?.native_tool_loop) return null;

    try {
      const system = await this._build_system_prompt(args.skill_names, args.req.provider, args.req.message.chat_id);
      const caps = backend.capabilities;
      return await this.agent_backends.run(backend.id, {
        task: seed_prompt,
        task_id: `task:${task_id}`,
        system_prompt: system,
        tools: args.tool_definitions as ToolSchema[],
        tool_executors: this.runtime.get_tool_executors(),
        runtime_policy: args.runtime_policy,
        max_tokens: 1800,
        temperature: 0.3,
        max_turns: this.config.agent_loop_max_turns,
        effort: "high",
        ...(caps.thinking ? { enable_thinking: true, max_thinking_tokens: 16000 } : {}),
        hooks: this._build_agent_hooks(stream, args.req.on_stream, args.runtime_policy, { channel: args.req.provider, chat_id: String(args.req.message.chat_id || "") }, args.req.on_tool_block, backend.id, args.req.on_progress, args.req.run_id, args.req.on_agent_event).hooks,
        abort_signal: args.req.signal,
        mcp_server_configs: this.get_mcp_configs?.() ?? undefined,
        tool_context: task_tool_ctx,
        ...(resume_session ? { resume_session } : {}),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn("native_tool_loop task_execute error, falling back to legacy", { error: msg });
      return null;
    }
  }

  /** native backend용 AgentHooks를 조립. on_stream + approval bridge + CD 옵저버 + progress 브릿지. */
  private _build_agent_hooks(
    buffer: StreamBuffer,
    on_stream: ((chunk: string) => void) | undefined,
    runtime_policy: RuntimeExecutionPolicy,
    channel_context?: { channel: string; chat_id: string },
    on_tool_block?: (block: string) => void,
    backend_id?: import("../agent/agent.types.js").AgentBackendId,
    on_progress?: OrchestrationRequest["on_progress"],
    run_id?: string,
    on_agent_event?: OrchestrationRequest["on_agent_event"],
  ): { hooks: AgentHooks; cd: CDObserver } {
    const cd = create_cd_observer();
    const hooks: AgentHooks = {};
    let progress_step = 0;

    hooks.on_event = (event: AgentEvent) => {
      // Dashboard SSE 릴레이
      if (on_agent_event) {
        try { on_agent_event(event); } catch { /* SSE 실패가 실행을 차단하면 안 됨 */ }
      }
      const cd_event = cd.observe(event);
      this.session_cd.observe(event);

      // task_lifecycle → ProgressEvent 브릿지
      if (event.type === "task_lifecycle" && on_progress && channel_context) {
        progress_step += 1;
        on_progress({
          task_id: event.sdk_task_id,
          step: progress_step,
          description: event.description || event.summary || event.sdk_task_id,
          provider: channel_context.channel,
          chat_id: channel_context.chat_id,
          at: event.at,
        });
      }
      if (cd_event) {
        this.logger.info("cd_event", { indicator: cd_event.indicator, points: cd_event.points, total: cd.get_score().total });
      }
      // tool_use + tool_result → on_tool_block 사용 시 별도 메시지로 분리
      if (on_tool_block && (event.type === "tool_use" || event.type === "tool_result")) {
        const hl = `\`${event.tool_name || "tool"}\``;
        if (event.type === "tool_use") {
          on_tool_block(`▸ ${hl} …`);
        } else {
          const brief = format_tool_result_brief(event.result);
          const status = event.is_error ? "✗" : "→";
          on_tool_block(`▸ ${hl} ${status} ${brief}`);
        }
        return;
      }

      if (!on_stream) return;
      let inject: string | null = null;

      // tool_use → 도구 실행 시작 라벨
      if (event.type === "tool_use") {
        inject = `\n▸ \`${event.tool_name}\``;
      }
      // tool_result → 도구 결과 요약 + WorkflowEventService 기록
      if (event.type === "tool_result") {
        const brief = event.result.slice(0, 80).replace(/\n/g, " ");
        inject = event.is_error ? ` ✗ ${brief}` : ` → ${brief}`;
        if (run_id && channel_context) {
          this.log_event({
            run_id,
            task_id: event.source.task_id || run_id,
            agent_id: backend_id || "unknown",
            provider: channel_context.channel,
            channel: channel_context.channel,
            chat_id: channel_context.chat_id,
            source: "system",
            phase: "progress",
            summary: `tool: ${event.tool_name}${event.is_error ? " (error)" : ""}`,
            detail: event.result.slice(0, 500),
            payload: { tool_name: event.tool_name, tool_id: event.tool_id, is_error: event.is_error },
          });
        }
      }
      // task_lifecycle → 서브태스크 진행 상황
      if (event.type === "task_lifecycle") {
        const label = event.status === "started" ? "▶" : event.status === "progress" ? "⋯" : event.status === "completed" ? "✓" : "✗";
        inject = `\n${label} ${event.description || event.summary || event.sdk_task_id}`;
      }
      // auth_request → 인증 URL/메시지
      if (event.type === "auth_request" && event.messages.length > 0) {
        inject = `\n🔐 Authentication required:\n${event.messages.join("\n")}`;
      }
      // rate_limit → 채널에 경고 표시 (warning + rejected)
      if (event.type === "rate_limit" && (event.status === "rejected" || event.status === "allowed_warning")) {
        const reset = event.resets_at ? ` (resets ${new Date(event.resets_at * 1000).toISOString().slice(11, 19)})` : "";
        inject = event.status === "rejected"
          ? `\n⚠️ Rate limit exceeded${reset}`
          : `\n⚠️ Rate limit warning (${Math.round((event.utilization ?? 0) * 100)}%)${reset}`;
      }
      // error → 채널에 에러 표시
      if (event.type === "error") {
        inject = `\n❌ ${event.error}`;
      }
      // tool_summary → 도구 실행 요약 전달
      if (event.type === "tool_summary" && event.summary) {
        inject = `\n${event.summary}`;
      }
      // compact_boundary → 컨텍스트 압축 알림
      if (event.type === "compact_boundary") {
        inject = "\n📦 컨텍스트 압축 중...";
      }
      // usage → 토큰/비용 로깅 (모니터링 연결)
      if (event.type === "usage") {
        this.logger.info("agent_usage", {
          backend: event.source.backend,
          input: event.tokens.input,
          output: event.tokens.output,
          cache_read: event.tokens.cache_read,
          cost_usd: event.cost_usd,
        });
      }

      if (inject) {
        buffer.append(inject);
        const flushed = buffer.flush();
        if (flushed) {
          try { on_stream(flushed); } catch { /* stream failure 무시 */ }
        }
      }
    };

    const stream_handler = this.create_stream_handler(buffer, on_stream);
    if (stream_handler) hooks.on_stream = stream_handler;

    const approval = runtime_policy?.sandbox?.approval || "auto-approve";
    if (approval !== "auto-approve" && channel_context) {
      hooks.on_approval = async (request) => {
        this.logger.info("approval_bridge_request", { tool: request.tool_name, type: request.type });
        const { decision } = this.runtime.register_approval_with_callback(
          request.tool_name || "unknown",
          request.detail || `tool: ${request.tool_name}`,
          { channel: channel_context.channel, chat_id: channel_context.chat_id },
        );
        const resolved = await decision;
        if (resolved === "approve") return "accept";
        if (resolved === "deny") return "deny";
        return "cancel";
      };
    }

    // pre_tool_use: 런타임 정책 기반 도구 실행 전 검증 (SDK PreToolUse / Codex item/tool/call에 연결)
    if (runtime_policy) {
      hooks.pre_tool_use = create_policy_pre_hook(runtime_policy);
    }

    // post_tool_use: CD 점수 관측 + spawn→link_subagent 연결
    hooks.post_tool_use = (tool_name, params, result, _context, is_error) => {
      this.session_cd.observe({
        type: "tool_result",
        source: { backend: backend_id || "claude_sdk" },
        at: now_iso(),
        tool_name,
        tool_id: "",
        result: String(result || "").slice(0, 200),
        params,
        is_error,
      });
      // spawn 도구 결과에서 subagent_id를 추출하여 ProcessTracker에 연결
      if (tool_name === "spawn" && run_id && !is_error) {
        try {
          const parsed = JSON.parse(String(result || "{}")) as Record<string, unknown>;
          const sid = String(parsed.subagent_id || "").trim();
          if (sid) this.process_tracker?.link_subagent(run_id, sid);
        } catch { /* noop */ }
      }
    };

    return { hooks, cd };
  }

  /** 실행 모드 + 모델 정보를 스트림에 주입하여 사용자에게 진행 상태 표시. */
  private emit_execution_info(
    buffer: StreamBuffer,
    on_stream: ((chunk: string) => void) | undefined,
    mode: string,
    executor: string,
  ): void {
    if (!on_stream) return;
    buffer.append(`[${mode} | ${executor}]`);
    const content = buffer.flush();
    if (content) {
      try { on_stream(content); } catch { /* stream failure 무시 */ }
    }
  }

  private create_tool_call_handler(
    tool_ctx: ToolExecutionContext,
    state: ToolCallState,
    stream_ctx?: {
      buffer: StreamBuffer;
      on_stream?: (chunk: string) => void;
      on_tool_block?: (block: string) => void;
      on_tool_event?: (event: AgentEvent) => void;
      /** 워크플로우 이벤트 기록 컨텍스트. 제공 시 도구 실행이 워크플로우 이벤트에 기록됨. */
      log_ctx?: { run_id: string; agent_id: string; provider: string; chat_id: string };
    },
  ): (args: { tool_calls: ToolCallEntry[] }) => Promise<string> {
    const max_chars = this.config.max_tool_result_chars;
    const flush_stream = () => {
      if (!stream_ctx?.on_stream) return;
      const content = stream_ctx.buffer.flush();
      if (content) {
        try { stream_ctx.on_stream(content); } catch { /* stream failure 무시 */ }
      }
    };
    return async ({ tool_calls }) => {
      const outputs: string[] = [];
      for (const tc of tool_calls) {
        if (tc.name === "request_file") state.file_requested = true;
        if (tc.name === "message" && is_done_phase((tc.arguments || {}) as Record<string, unknown>)) {
          state.suppress = true;
          state.done_sent = true;
        }
        const label = format_tool_label(tc.name, tc.arguments);
        if (stream_ctx?.on_tool_event) {
          stream_ctx.on_tool_event({
            type: "tool_use",
            source: { backend: "claude_cli" as const, task_id: tool_ctx.task_id },
            at: now_iso(),
            tool_name: tc.name, tool_id: "",
            params: tc.arguments || {},
          });
        }
        try {
          this.logger.debug("tool_call", { name: tc.name, args: tc.arguments });
          const result = await this.runtime.execute_tool(tc.name, tc.arguments || {}, tool_ctx);
          state.tool_count += 1;
          this.logger.debug("tool_result", { name: tc.name, result: String(result).slice(0, 200) });
          const truncated = truncate_tool_result(result, max_chars);
          if (stream_ctx?.on_tool_event) {
            stream_ctx.on_tool_event({
              type: "tool_result",
              source: { backend: "claude_cli" as const, task_id: tool_ctx.task_id },
              at: now_iso(),
              tool_name: tc.name, tool_id: "",
              result: truncated, params: tc.arguments, is_error: false,
            });
          }
          if (stream_ctx?.log_ctx) {
            const lc = stream_ctx.log_ctx;
            this.log_event({
              run_id: lc.run_id, task_id: tool_ctx.task_id || lc.run_id,
              agent_id: lc.agent_id, provider: lc.provider, channel: lc.provider, chat_id: lc.chat_id,
              source: "system", phase: "progress",
              summary: `tool: ${tc.name}`,
              detail: truncated.slice(0, 500),
              payload: { tool_name: tc.name, is_error: false },
            });
          }
          const block = format_tool_block(label, result, false);
          if (stream_ctx?.on_tool_block) {
            stream_ctx.on_tool_block(block);
          } else if (stream_ctx?.on_stream) {
            stream_ctx.buffer.append(block);
            flush_stream();
          }
          outputs.push(`[tool:${tc.name}] ${truncated}`);
        } catch (e) {
          state.tool_count += 1;
          const err_msg = e instanceof Error ? e.message : String(e);
          this.logger.debug("tool_error", { name: tc.name, error: err_msg });
          if (stream_ctx?.on_tool_event) {
            stream_ctx.on_tool_event({
              type: "tool_result",
              source: { backend: "claude_cli" as const, task_id: tool_ctx.task_id },
              at: now_iso(),
              tool_name: tc.name, tool_id: "",
              result: err_msg, params: tc.arguments, is_error: true,
            });
          }
          if (stream_ctx?.log_ctx) {
            const lc = stream_ctx.log_ctx;
            this.log_event({
              run_id: lc.run_id, task_id: tool_ctx.task_id || lc.run_id,
              agent_id: lc.agent_id, provider: lc.provider, channel: lc.provider, chat_id: lc.chat_id,
              source: "system", phase: "progress",
              summary: `tool: ${tc.name} (error)`,
              detail: err_msg.slice(0, 500),
              payload: { tool_name: tc.name, is_error: true },
            });
          }
          const block = format_tool_block(label, err_msg, true);
          if (stream_ctx?.on_tool_block) {
            stream_ctx.on_tool_block(block);
          } else if (stream_ctx?.on_stream) {
            stream_ctx.buffer.append(block);
            flush_stream();
          }
          outputs.push(`[tool:${tc.name}] error: ${err_msg}`);
        }
      }
      return outputs.join("\n");
    };
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
    const out: string[] = [];
    for (const v of values) {
      const raw = String(v || "").trim();
      if (!raw) continue;
      if (is_local_reference(raw)) { out.push(raw); continue; }
      const sealed = await this.seal_text(provider, chat_id, raw);
      if (sealed.trim()) out.push(sealed);
    }
    return out;
  }

  private async inspect_secrets(inputs: string[]): Promise<{ ok: boolean; missing_keys: string[]; invalid_ciphertexts: string[] }> {
    const missing = new Set<string>();
    const invalid = new Set<string>();
    for (const text of inputs) {
      if (!text.trim()) continue;
      const report = await this.vault.inspect_secret_references(text);
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
    const executor = resolve_executor_provider(this.config.executor_provider);
    this.emit_execution_info(stream, req.on_stream, "task (재개)", executor);
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
        run: async ({ memory }) => {
          const objective = memory.__user_input
            ? `${String(memory.objective || "")}\n\n[사용자 응답] ${String(memory.__user_input)}`
            : String(memory.objective || task_with_media);

          // native backend 우선
          const native_result = await this._try_native_task_execute(
            { req, executor, task_with_media, media: media, context_block, skill_names, runtime_policy, tool_definitions: all_tool_definitions, tool_ctx },
            stream, tool_ctx, task.taskId, objective, context_block,
            prior_session,
          );
          if (native_result) {
            this.flush_remaining(stream, req.on_stream);
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
          const resumed_loop_id = `resumed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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
            current_message: context_block,
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
            on_stream: this.create_stream_handler(stream, req.on_stream),
            check_should_continue: async () => false,
            on_tool_calls: this.create_tool_call_handler(tool_ctx, state, {
              buffer: stream, on_stream: req.on_stream, on_tool_block: req.on_tool_block,
              on_tool_event: (e) => this.session_cd.observe(e),
              log_ctx: req.run_id ? { run_id: req.run_id, agent_id: String(executor), provider: req.provider, chat_id: req.message.chat_id } : undefined,
            }),
          });

          this.flush_remaining(stream, req.on_stream);
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
        run_id: req.run_id || `resume-${Date.now()}`, task_id: task.taskId, agent_id: req.alias,
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

const FINISH_REASON_WARNINGS: Record<string, string> = {
  max_turns: "최대 턴 수에 도달하여 작업이 중단되었습니다.",
  max_budget: "예산 한도에 도달하여 작업이 중단되었습니다.",
  max_tokens: "최대 토큰 수에 도달하여 응답이 잘렸을 수 있습니다.",
  output_retries: "출력 재시도 한도에 도달했습니다.",
};

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

function inbound_scope_id(message: InboundMessage): string {
  const meta = (message.metadata || {}) as Record<string, unknown>;
  const raw = String(meta.message_id || message.id || "").trim();
  if (!raw) return `msg-${Date.now()}`;
  return raw.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 96) || `msg-${Date.now()}`;
}


/** @internal — exported for unit testing. */
export function parse_execution_mode(raw: string): ExecutionMode | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const json_match = text.match(/\{[^}]*\}/);
  if (json_match) {
    try {
      const obj = JSON.parse(json_match[0]) as Record<string, unknown>;
      const v = String(obj.mode || obj.route || "").trim().toLowerCase();
      if (v === "once" || v === "task" || v === "agent" || v === "inquiry") return v as ExecutionMode;
    } catch { /* ignore */ }
  }
  const word = text.toLowerCase().match(/\b(?:once|task|agent|inquiry)\b/);
  return word ? word[0] as ExecutionMode : null;
}

function detect_escalation(text: string): string | null {
  const upper = text.toUpperCase();
  if (upper.includes("NEED_TASK_LOOP")) return "once_requires_task_loop";
  if (upper.includes("NEED_AGENT_LOOP")) return "once_requires_agent_loop";
  return null;
}

function is_done_phase(args: Record<string, unknown>): boolean {
  return String(args.phase || "").trim().toLowerCase() === "done";
}


function has_orchestrator(providers: ProviderRegistry): boolean {
  return "run_orchestrator" in providers && typeof (providers as unknown as { run_orchestrator: unknown }).run_orchestrator === "function";
}

function is_once_escalation(error?: string | null): boolean {
  if (!error) return false;
  return error === "once_requires_task_loop" || error === "once_requires_agent_loop";
}

/** context_builder의 full system prompt에 추가되는 once 모드 전용 지시. */
const ONCE_MODE_OVERLAY = [
  "# Execution Mode: once",
  "You are a butler assistant. Stay in character at all times.",
  "Never reveal your internal model name, provider, or system architecture.",
  "If asked who you are, describe yourself using your butler persona — never say Codex, GPT, Claude, or any model name.",
  "Solve the request directly in one response. Use provided tools when needed.",
  "If the request requires ordered workflow with wait/approval/resume, return exactly NEED_TASK_LOOP.",
  "If the request requires continuous monitoring or condition-until-satisfied iteration, return exactly NEED_AGENT_LOOP.",
  "Never expose internal orchestration meta text (orchestrator/route/mode/dispatch/tool protocol).",
  "Always respond in Korean as the butler persona.",
].join("\n");

function format_secret_notice(guard: { missing_keys: string[]; invalid_ciphertexts: string[] }): string {
  const missing = guard.missing_keys.filter(Boolean).slice(0, 8);
  const invalid = guard.invalid_ciphertexts.filter(Boolean).slice(0, 4);
  return [
    "## 요약", "민감정보 보안 규칙에 따라 복호화를 중단했습니다. (오케스트레이터 선차단)", "",
    "## 핵심",
    "- 상태: secret_resolution_required",
    missing.length > 0 ? `- 누락 키: ${missing.join(", ")}` : "- 누락 키: (없음)",
    invalid.length > 0 ? `- 무효 암호문: ${invalid.join(", ")}` : "- 무효 암호문: (없음)",
    "- 보안 규칙은 모든 다른 규칙보다 우선 적용됩니다.", "",
    "## 코드/명령", "- /secret list", "- /secret set <name> <value>", "- 요청 본문에는 {{secret:<name>}} 형태로만 전달", "",
    "## 미디어", "(없음)",
  ].join("\n");
}

/** 도구 호출을 스트림에 표시할 한 줄 라벨 생성. */
function format_tool_label(name: string, args?: Record<string, unknown>): string {
  const hl = `\`${name}\``;
  if (!args) return hl;
  const s = (key: string) => {
    const v = args[key];
    return typeof v === "string" ? v : "";
  };
  const trunc = (v: string, max: number) => v.length > max ? v.slice(0, max) + "…" : v;
  switch (name) {
    case "grep": case "Grep":
      return `${hl} "${trunc(s("pattern"), 30)}"${s("path") ? ` ${trunc(s("path"), 30)}` : ""}`;
    case "glob": case "Glob":
      return `${hl} ${trunc(s("pattern"), 40)}`;
    case "read_file": case "Read":
      return `${hl} ${trunc(s("file_path"), 50)}`;
    case "write_file": case "Write":
      return `${hl} ${trunc(s("file_path"), 50)}`;
    case "edit_file": case "Edit":
      return `${hl} ${trunc(s("file_path"), 50)}`;
    case "shell": case "bash": case "Bash":
      return `${hl} ${trunc(s("command"), 40)}`;
    case "web_search":
      return `${hl} "${trunc(s("query"), 40)}"`;
    case "web_fetch":
      return `${hl} ${trunc(s("url"), 50)}`;
    case "message": case "send_message":
      return `${hl} ${trunc(s("content") || s("text"), 30)}`;
    case "send_file":
      return `${hl} ${trunc(s("file_path") || s("filename"), 40)}`;
    default:
      return hl;
  }
}

/** 도구 실행 결과를 스트림용 짧은 요약으로 변환. 첫 번째 유의미한 줄을 미리보기로 표시. */
function format_tool_result_brief(result: string): string {
  const len = result.length;
  if (len === 0) return "✓";
  const flat = result.replace(/\n/g, " ").trim();
  if (len <= 80) return flat;
  const first = result.split("\n").find((l) => l.trim())?.trim() || flat;
  const preview = first.length > 80 ? first.slice(0, 77) + "…" : first;
  const size = len > 1000 ? `${(len / 1000).toFixed(1)}k자` : `${len}자`;
  return `${preview} (${size})`;
}

/** 도구 실행 블록을 채널 별도 메시지용으로 포맷. */
function format_tool_block(label: string, result: string, is_error: boolean): string {
  const brief = format_tool_result_brief(result);
  const status = is_error ? "✗" : "→";
  return `▸ ${label} ${status} ${brief}`;
}

function truncate_tool_result(result: string, max_chars: number): string {
  const limit = Math.max(100, max_chars);
  if (result.length <= limit) return result;
  const half = Math.floor((limit - 40) / 2);
  return `${result.slice(0, half)}\n...[truncated ${result.length - limit} chars]...\n${result.slice(-half)}`;
}

// ── 작업 상태 조회 응답 포맷 ──

function format_active_task_summary(
  tasks: import("../contracts.js").TaskState[],
  find_session?: (task_id: string) => import("../agent/agent.types.js").AgentSession | null,
): string {
  const STATUS_EMOJI: Record<string, string> = {
    running: "🔄", waiting_approval: "🔐", waiting_user_input: "💬",
    failed: "❌", max_turns_reached: "⚠️", completed: "✅", cancelled: "🚫",
  };
  const lines = [`📋 현재 활성 작업 ${tasks.length}건`];
  for (const t of tasks) {
    const icon = STATUS_EMOJI[t.status] || "❓";
    const step = t.currentStep ? ` · step: ${t.currentStep}` : "";
    const session = find_session?.(t.taskId);
    const session_label = session ? ` · session: \`${session.session_id.slice(0, 12)}\` (${session.backend})` : "";
    lines.push(`${icon} \`${t.taskId}\`  ${t.title || "(제목 없음)"}`);
    lines.push(`  [${t.status}] turn ${t.currentTurn}/${t.maxTurns}${step}${session_label}`);
  }
  lines.push("", "상세: `/task status <id>` · 취소: `/task cancel <id>`");
  return lines.join("\n");
}

const EXECUTION_MODE_CLASSIFY_PROMPT = [
  "You are an execution mode classifier. Your ONLY job is to read the user request and pick one mode.",
  "You MUST return valid JSON and nothing else: {\"mode\":\"once\"} or {\"mode\":\"agent\"} or {\"mode\":\"task\"}",
  "",
  "# Mode Definitions (read carefully)",
  "",
  "## once",
  "A single-turn response. The executor answers in one shot, optionally using one round of tool calls.",
  "Use once for:",
  "- Questions and greetings: 안녕, 뭐해?, 날씨 알려줘",
  "- Informational statements with no action: 새 기능 추가됐어, 알겠어, 참고해",
  "- Simple commands that need just one tool call: 파일 첨부해줘, 이미지 보내줘, 크론 등록해줘, 웹 검색해줘",
  "- Status queries: 상태 알려줘, 스킬 목록, 메모리 검색",
  "- Scheduling: 매일 9시에 리포트 보내줘, 크론 삭제해줘",
  "",
  "## agent",
  "Multi-step iterative work. The executor loops: think → use tools → check result → repeat until done.",
  "Use agent for:",
  "- Research + write output: 조사해서 리포트/보고서/분석을 만들어줘",
  "- Analyze + generate artifact: 데이터를 분석하고 차트/표/PDF를 만들어줘",
  "- Multi-file operations: 코드를 분석하고 리팩토링해줘",
  "- Open-ended exploration: 자세한 정보를 찾아서 정리해줘",
  "- Any request combining 2+ distinct actions: 검색 + 요약, 분석 + 생성, 수집 + 비교",
  "",
  "## task",
  "Long-running structured workflow requiring explicit human approval between phases.",
  "Use task ONLY when the user explicitly asks for:",
  "- Human approval/confirmation gates between steps: 확인받고 진행, 승인 후 다음 단계",
  "- Pause and resume: 중간에 멈추고, 이어서 진행",
  "- Phased execution: 1단계, 2단계... 단계마다 검토",
  "IMPORTANT: task is rare. Most multi-step work is agent, not task.",
  "",
  "# Examples",
  "",
  "## once examples",
  "User: \"안녕\" → {\"mode\":\"once\"}",
  "User: \"오늘 날씨 알려줘\" → {\"mode\":\"once\"}",
  "User: \"이 파일 여기에 첨부해줘\" → {\"mode\":\"once\"}",
  "User: \"다시 결과를 여기에 첨부해줘\" → {\"mode\":\"once\"}",
  "User: \"이제 첨부 도구가 사용 가능할거야\" → {\"mode\":\"once\"}",
  "User: \"크론 등록해줘 매일 9시\" → {\"mode\":\"once\"}",
  "User: \"메모리에서 지난 회의 내용 찾아줘\" → {\"mode\":\"once\"}",
  "User: \"이전에 만든 PDF 보내줘\" → {\"mode\":\"once\"}",
  "User: \"고마워\" → {\"mode\":\"once\"}",
  "User: \"스킬 목록 보여줘\" → {\"mode\":\"once\"}",
  "",
  "## agent examples",
  "User: \"아이유에 대해 조사하고 리포트를 PDF로 만들어서 첨부해줘\" → {\"mode\":\"agent\"}",
  "User: \"경쟁사 3곳을 분석하고 비교표를 만들어줘\" → {\"mode\":\"agent\"}",
  "User: \"코드를 분석하고 리팩토링 계획을 세워줘\" → {\"mode\":\"agent\"}",
  "User: \"최신 뉴스를 수집해서 요약 보고서를 작성해줘\" → {\"mode\":\"agent\"}",
  "User: \"이 API 문서를 분석하고 클라이언트 코드를 생성해줘\" → {\"mode\":\"agent\"}",
  "User: \"자세한 정보를 찾아서 분석하고 리포트를 만들어줘\" → {\"mode\":\"agent\"}",
  "",
  "## task examples",
  "User: \"이 프로젝트를 리팩토링해줘 단계마다 확인받고 진행해\" → {\"mode\":\"task\"}",
  "User: \"배포 파이프라인 만들어줘 각 단계에서 승인 필요\" → {\"mode\":\"task\"}",
  "User: \"데이터 마이그레이션 진행해줘 각 테이블마다 내 승인 받고\" → {\"mode\":\"task\"}",
  "",
  "# Decision Flowchart",
  "1. Does the user request any action? No → once",
  "2. Does it need multiple distinct steps (research+create, analyze+generate)? No → once",
  "3. Does the user explicitly request approval gates or pause/resume? Yes → task",
  "4. Otherwise → agent",
].join("\n");

/** 활성 작업이 있을 때 분류기에 추가되는 inquiry 모드 설명. */
const INQUIRY_MODE_ADDENDUM = [
  "",
  "## inquiry",
  "The user is asking about the status or progress of an active task. No new agent spawn is needed.",
  "Use inquiry when the user asks about:",
  "- Progress: 진행중이야?, 어떻게 됐어?, 어디까지 했어?",
  "- Status check: 상태 알려줘, 끝났어?, 아직 하고 있어?",
  "- Result inquiry: 결과 나왔어?, 완료됐어?",
  "- General follow-up about an active task without requesting new work",
  "IMPORTANT: inquiry applies ONLY when the user is asking about existing active tasks, not requesting new work.",
  "If the user requests new/different work even though tasks are active, do NOT use inquiry.",
  "",
  "## inquiry examples",
  "User: \"진행중이야?\" → {\"mode\":\"inquiry\"}",
  "User: \"작업 어떻게 돼가?\" → {\"mode\":\"inquiry\"}",
  "User: \"끝났어?\" → {\"mode\":\"inquiry\"}",
  "User: \"아직 하고 있어?\" → {\"mode\":\"inquiry\"}",
  "User: \"결과 나왔어?\" → {\"mode\":\"inquiry\"}",
  "User: \"이전 작업 상태 확인해줘\" → {\"mode\":\"inquiry\"}",
  "",
  "# Updated Decision Flowchart (replaces the previous one)",
  "1. Are there active tasks AND does the user ask about their status/progress? Yes → inquiry",
  "2. Does the user request any action? No → once",
  "3. Does it need multiple distinct steps (research+create, analyze+generate)? No → once",
  "4. Does the user explicitly request approval gates or pause/resume? Yes → task",
  "5. Otherwise → agent",
].join("\n");

function build_active_task_context(tasks: import("../contracts.js").TaskState[]): string {
  const lines = ["", "# Active Tasks in this chat"];
  for (const t of tasks) {
    const step = t.currentStep ? `, step=${t.currentStep}` : "";
    lines.push(`- ${t.taskId} [${t.status}] "${t.title}" turn=${t.currentTurn}/${t.maxTurns}${step}`);
  }
  return lines.join("\n");
}
