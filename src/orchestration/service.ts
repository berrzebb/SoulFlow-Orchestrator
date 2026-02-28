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

  constructor(deps: OrchestrationServiceDeps) {
    this.providers = deps.providers;
    this.runtime = deps.agent_runtime;
    this.vault = deps.secret_vault;
    this.policy_resolver = deps.runtime_policy_resolver;
    this.config = deps.config;
    this.logger = deps.logger;
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

    this.runtime.apply_tool_runtime_context({
      channel: req.provider,
      chat_id: req.message.chat_id,
      reply_to: resolve_reply_to(req.provider, req.message),
    });

    const history_lines = req.session_history.slice(-8).map((r) => `[${r.role}] ${r.content}`);
    const context_block = build_context_message(task_with_media, history_lines);
    const tool_ctx = build_tool_context(req, request_task_id);

    const skill_tool_names = this.collect_skill_tool_names(skill_names);
    const mode = await this.pick_execution_mode(task_with_media);
    const { tools: tool_definitions } = select_tools_for_request(all_tool_definitions, task_with_media, mode, skill_tool_names);
    this.logger.info("dispatch", { mode });

    const executor = resolve_executor_provider(this.config.executor_provider);

    // once → executor 1회 호출. 에스컬레이션 시 executor 루프로 전환.
    let escalation_error: string | undefined;
    if (mode === "once") {
      const once_result = await this.run_once({
        req, executor, task_with_media, context_block, skill_names,
        runtime_policy, tool_definitions, tool_ctx,
      });
      if (!is_once_escalation(once_result.error)) {
        return once_result;
      }
      escalation_error = once_result.error ?? undefined;
    }

    // agent/task 또는 once 에스컬레이션 → executor 루프
    const loop_mode: "task" | "agent" = mode === "task"
      ? "task"
      : (escalation_error === "once_requires_task_loop" ? "task" : "agent");

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
    if (first.reply || first.suppress_reply) return first;

    if (executor === "claude_code") {
      const fallback = resolve_executor_provider("chatgpt");
      if (fallback !== executor) {
        this.logger.warn("executor failed, trying fallback", { executor, fallback, error: first.error });
        const second = await run_loop(fallback);
        if (second.reply || second.suppress_reply) return second;
        return { ...second, error: second.error || first.error };
      }
    }
    return first;
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
    const context_builder = this.runtime.get_context_builder();
    const system = await context_builder.build_system_prompt(
      args.skill_names,
      undefined,
      { channel: args.req.provider, chat_id: args.req.message.chat_id },
    );
    const butler = context_builder.get_role_persona("butler");
    const active_role_hint = butler?.heart
      ? `\n\n# Active Role: butler\n${butler.heart}`
      : "";
    const messages: ChatMessage[] = [
      { role: "system", content: `${system}${active_role_hint}\n\n${ONCE_MODE_OVERLAY}` },
      { role: "user", content: args.context_block },
    ];

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
        const handler = this.create_tool_call_handler(args.tool_ctx, tool_state, { buffer: stream, on_stream: args.req.on_stream });
        const tool_output = await handler({ tool_calls: response.tool_calls });

        if (tool_state.suppress) return suppress_result("once", stream, tool_state.tool_count);

        const followup = await this.providers.run_headless({
          provider_id: args.executor,
          messages: [
            ...messages,
            { role: "assistant", content: `[TOOL_RESULTS]\n${tool_output}` },
            { role: "user", content: this.build_persona_followup(butler?.heart || "") },
          ],
          max_tokens: 800,
          temperature: 0.2,
          abort_signal: args.req.signal,
          on_stream: this.create_stream_handler(stream, args.req.on_stream),
        });
        const followup_text = sanitize_provider_output(String(followup.content || "")).trim();
        const final_text = followup_text || tool_output;
        return reply_result("once", stream, normalize_agent_reply(final_text, args.req.alias, args.req.message.sender_id), tool_state.tool_count);
      }

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
    const state: ToolCallState = { suppress: false, tool_count: 0 };

    const response = await this.runtime.run_agent_loop({
      loop_id: `loop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
      on_tool_calls: this.create_tool_call_handler(args.tool_ctx, state, { buffer: stream, on_stream: args.req.on_stream }),
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
          const state: ToolCallState = { suppress: false, file_requested: false, done_sent: false, tool_count: 0 };
          const task_tool_ctx: ToolExecutionContext = { ...args.tool_ctx, task_id };

          const response = await this.runtime.run_agent_loop({
            loop_id: `nested-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            agent_id: args.req.alias,
            objective: String(memory.objective || args.task_with_media),
            context_builder: this.runtime.get_context_builder(),
            providers: this.providers,
            tools: args.tool_definitions,
            provider_id: args.executor,
            runtime_policy: args.runtime_policy,
            current_message: String(memory.seed_prompt || args.context_block),
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
            on_tool_calls: this.create_tool_call_handler(task_tool_ctx, state, { buffer: stream, on_stream: args.req.on_stream }),
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
    });

    const output_raw = String(result.state.memory?.last_output || "").trim();
    if (result.state.memory?.file_request_waiting === true || output_raw === FILE_WAIT_MARKER) {
      return suppress_result("task", stream, total_tool_count);
    }
    if (result.state.memory?.suppress_final_reply === true) {
      return suppress_result("task", stream, total_tool_count);
    }
    if (result.state.status === "waiting_approval") {
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
  private async pick_execution_mode(task: string): Promise<ExecutionMode> {
    const text = String(task || "").trim();
    if (!text) return "once";
    if (!has_orchestrator(this.providers)) return "once";

    try {
      const response = await this.providers.run_orchestrator({
        messages: [
          { role: "system", content: EXECUTION_MODE_CLASSIFY_PROMPT },
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
    stream_ctx?: { buffer: StreamBuffer; on_stream?: (chunk: string) => void },
  ): (args: { tool_calls: ToolCallEntry[] }) => Promise<string> {
    const max_chars = this.config.max_tool_result_chars;
    return async ({ tool_calls }) => {
      const outputs: string[] = [];
      for (const tc of tool_calls) {
        if (tc.name === "request_file") state.file_requested = true;
        if (tc.name === "message" && is_done_phase((tc.arguments || {}) as Record<string, unknown>)) {
          state.suppress = true;
          state.done_sent = true;
        }
        if (stream_ctx?.on_stream) {
          stream_ctx.buffer.append(`\n[${tc.name} 실행 중...]`);
          const content = stream_ctx.buffer.flush();
          if (content) {
            try { stream_ctx.on_stream(content); } catch { /* stream failure 무시 */ }
          }
        }
        try {
          this.logger.debug("tool_call", { name: tc.name, args: tc.arguments });
          const result = await this.runtime.execute_tool(tc.name, tc.arguments || {}, tool_ctx);
          state.tool_count += 1;
          this.logger.debug("tool_result", { name: tc.name, result: String(result).slice(0, 200) });
          outputs.push(`[tool:${tc.name}] ${truncate_tool_result(result, max_chars)}`);
        } catch (e) {
          state.tool_count += 1;
          this.logger.debug("tool_error", { name: tc.name, error: e instanceof Error ? e.message : String(e) });
          outputs.push(`[tool:${tc.name}] error: ${e instanceof Error ? e.message : String(e)}`);
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

    this.runtime.apply_tool_runtime_context({
      channel: req.provider,
      chat_id: req.message.chat_id,
      reply_to: resolve_reply_to(req.provider, req.message),
    });

    const user_input = String(task.memory.__user_input || task_with_media);
    const history_lines = req.session_history.slice(-8).map((r) => `[${r.role}] ${r.content}`);
    const context_block = build_context_message(user_input, history_lines);

    const nodes: TaskNode[] = [
      {
        id: "execute",
        run: async ({ memory }) => {
          const objective = memory.__user_input
            ? `${String(memory.objective || "")}\n\n[사용자 응답] ${String(memory.__user_input)}`
            : String(memory.objective || task_with_media);

          const state: ToolCallState = { suppress: false, file_requested: false, done_sent: false, tool_count: 0 };
          const response = await this.runtime.run_agent_loop({
            loop_id: `resumed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
            on_tool_calls: this.create_tool_call_handler(tool_ctx, state, { buffer: stream, on_stream: req.on_stream }),
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
    });

    const output_raw = String(result.state.memory?.last_output || "").trim();
    if (result.state.memory?.suppress_final_reply === true) {
      return suppress_result("task", stream, total_tool_count);
    }
    if (result.state.status === "waiting_approval") {
      return { reply: "승인 대기 상태입니다. 승인 응답 후 같은 작업을 재개합니다.", mode: "task", tool_calls_count: total_tool_count, streamed: stream.has_streamed() };
    }
    if (result.state.status === "waiting_user_input") {
      const prompt_text = sanitize_provider_output(output_raw).trim();
      return { reply: prompt_text || "선택을 기다리고 있습니다.", mode: "task", tool_calls_count: total_tool_count, streamed: stream.has_streamed() };
    }

    const output = sanitize_provider_output(output_raw).trim();
    if (!output) return error_result("task", stream, `resume_task_no_output:${result.state.status}`, total_tool_count);
    return reply_result("task", stream, normalize_agent_reply(output, req.alias, req.message.sender_id), total_tool_count);
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
  return { reply: null, error, mode, tool_calls_count, streamed: stream?.has_streamed() ?? false };
}

function suppress_result(mode: ExecutionMode, stream: StreamBuffer, tool_calls_count = 0): OrchestrationResult {
  return { reply: null, suppress_reply: true, mode, tool_calls_count, streamed: stream.has_streamed(), stream_full_content: stream.get_full_content() };
}

function reply_result(mode: ExecutionMode, stream: StreamBuffer, reply: string | null, tool_calls_count = 0): OrchestrationResult {
  return { reply, mode, tool_calls_count, streamed: stream.has_streamed(), stream_full_content: stream.get_full_content() };
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
      if (v === "once" || v === "task" || v === "agent") return v;
    } catch { /* ignore */ }
  }
  const word = text.toLowerCase().match(/\b(?:once|task|agent)\b/);
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

function truncate_tool_result(result: string, max_chars: number): string {
  const limit = Math.max(100, max_chars);
  if (result.length <= limit) return result;
  const half = Math.floor((limit - 40) / 2);
  return `${result.slice(0, half)}\n...[truncated ${result.length - limit} chars]...\n${result.slice(-half)}`;
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
