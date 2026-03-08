import type { Logger } from "../logger.js";
import { now_iso, now_seoul_iso, error_message, short_id, normalize_text, sleep } from "../utils/common.js";
import type { ChatMessage, ProviderId, ProviderRegistry, ToolCallRequest } from "../providers/index.js";
import { create_default_tool_registry, type ToolRegistry } from "./tools.js";
import type { MessageBusLike } from "../bus/index.js";
import type { ContextBuilder } from "./context.js";
import { parse_tool_calls_from_text } from "./tool-call-parser.js";
import { resolve_executor_provider, type ProviderCapabilities } from "../providers/executor.js";
import type { AgentBackendRegistry } from "./agent-registry.js";
import type { ToolSchema } from "./tools/types.js";
import type { AgentBackendId, AgentEvent, AgentEventSource, AgentFinishReason, AgentHooks } from "./agent.types.js";
import { sandbox_from_preset, type RuntimeExecutionPolicy } from "../providers/types.js";
import { create_policy_pre_hook } from "./tools/index.js";
import { sanitize_provider_output, is_provider_error_reply } from "../channels/output-sanitizer.js";
import { FINISH_REASON_WARNINGS } from "./finish-reason-warnings.js";

export type SubagentStatus = "idle" | "running" | "completed" | "failed" | "cancelled" | "offline";

export interface SubagentRef {
  id: string;
  role: string;
  model?: string;
  status: SubagentStatus;
  /** CLI 세션 ID (claude: session_id, codex: thread_id). */
  session_id?: string;
  created_at?: string;
  updated_at?: string;
  last_error?: string;
  last_result?: string;
  label?: string;
}

export type SpawnSubagentOptions = {
  task: string;
  role?: string;
  soul?: string;
  heart?: string;
  label?: string;
  provider_id?: ProviderId;
  model?: string;
  max_iterations?: number;
  max_tokens?: number;
  temperature?: number;
  origin_channel?: string;
  origin_chat_id?: string;
  announce?: boolean;
  parent_id?: string;
  /** 추천된 스킬 이름 — build_system_prompt에 스킬 컨텍스트를 포함. */
  skill_names?: string[];
  /** 이벤트/스트림 훅. */
  hooks?: Pick<AgentHooks, "on_event" | "on_stream">;
  /** controller loop 생략 — executor 백엔드 직접 1회 호출. Phase Loop 등 외부 orchestrator가 있을 때 사용. */
  skip_controller?: boolean;
  /** 허용된 도구 ID 목록. 지정 시 이 목록에 포함된 도구만 executor에 전달. */
  allowed_tools?: string[];
};

type RunningSubagent = {
  ref: SubagentRef;
  abort: AbortController;
  done: Promise<void>;
  parent_id: string | null;
  /** late-binding: 백엔드가 연결 후 등록. */
  send_input?: (text: string) => void;
};

type ControllerPlan = {
  done: boolean;
  executor_prompt: string;
  final_answer: string;
  reason: string;
  handoffs: Array<{ alias: string; instruction: string }>;
};

export class SubagentRegistry {
  private readonly items = new Map<string, SubagentRef>();
  private readonly running = new Map<string, RunningSubagent>();
  private readonly workspace: string;
  private readonly providers: ProviderRegistry | null;
  private readonly bus: MessageBusLike | null;
  private readonly build_tools: () => ToolRegistry;
  private readonly context_builder: ContextBuilder | null;
  private readonly logger: Logger | null;
  private readonly agent_backends: AgentBackendRegistry | null;
  private readonly provider_caps: ProviderCapabilities;

  constructor(args?: {
    workspace?: string;
    providers?: ProviderRegistry | null;
    bus?: MessageBusLike | null;
    build_tools?: (() => ToolRegistry) | null;
    context_builder?: ContextBuilder | null;
    logger?: Logger | null;
    agent_backends?: AgentBackendRegistry | null;
    provider_caps?: ProviderCapabilities;
  }) {
    this.logger = args?.logger || null;
    if (!args?.workspace) throw new Error("workspace is required for SubagentRegistry");
    this.workspace = args.workspace;
    this.providers = args?.providers || null;
    this.bus = args?.bus || null;
    this.build_tools = args?.build_tools || (() => create_default_tool_registry({ workspace: this.workspace, bus: this.bus }).registry);
    this.context_builder = args?.context_builder || null;
    this.agent_backends = args?.agent_backends || null;
    this.provider_caps = args?.provider_caps || { chatgpt_available: false, claude_available: false, openrouter_available: false };
  }

  get_agent_backends(): AgentBackendRegistry | null {
    return this.agent_backends;
  }

  upsert(ref: SubagentRef): void {
    const prev = this.items.get(ref.id);
    this.items.set(ref.id, {
      ...prev,
      ...ref,
      created_at: prev?.created_at || ref.created_at || now_iso(),
      updated_at: now_iso(),
    });
    if (this.items.size > 500) this._prune_items();
  }

  private _prune_items(): void {
    const completed: { id: string; at: string }[] = [];
    for (const [id, ref] of this.items) {
      if (ref.status === "completed" || ref.status === "failed" || ref.status === "cancelled") {
        completed.push({ id, at: ref.updated_at || "" });
      }
    }
    completed.sort((a, b) => a.at.localeCompare(b.at));
    const target = Math.max(1, completed.length - 50);
    for (let i = 0; i < target; i++) this.items.delete(completed[i].id);
  }

  get(id: string): SubagentRef | null {
    return this.items.get(id) || null;
  }

  list(): SubagentRef[] {
    return [...this.items.values()].sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  }

  list_running(): SubagentRef[] {
    return [...this.running.values()].map((r) => r.ref);
  }

  get_running_count(): number {
    return this.running.size;
  }

  async wait_for_completion(
    id: string,
    timeout_ms = 0,
    poll_interval_ms = 150,
  ): Promise<{ status: SubagentStatus; content?: string; error?: string } | null> {
    const started = Date.now();
    while (true) {
      if (timeout_ms > 0 && Date.now() - started > timeout_ms) {
        return { status: "failed", error: `subagent_timeout_${timeout_ms}ms` };
      }
      const ref = this.items.get(id);
      if (!ref) return null;
      if (ref.status === "completed") {
        return { status: ref.status, content: ref.last_result };
      }
      if (ref.status === "failed" || ref.status === "cancelled" || ref.status === "offline") {
        return { status: ref.status, error: ref.last_error };
      }
      await sleep(Math.max(50, poll_interval_ms));
    }
  }

  private static readonly MAX_CONCURRENT_SUBAGENTS = 10;

  async spawn(options: SpawnSubagentOptions): Promise<{ subagent_id: string; status: string; message: string }> {
    if (!this.providers) {
      throw new Error("providers_not_configured");
    }
    if (this.running.size >= SubagentRegistry.MAX_CONCURRENT_SUBAGENTS) {
      return {
        subagent_id: "",
        status: "rejected",
        message: `concurrent subagent limit reached (${SubagentRegistry.MAX_CONCURRENT_SUBAGENTS})`,
      };
    }
    const subagent_id = short_id(8);
    const role = options.role || "worker";
    const label = options.label || options.task.slice(0, 40);
    const ref: SubagentRef = {
      id: subagent_id,
      role,
      model: options.model,
      status: "running",
      label,
      created_at: now_iso(),
      updated_at: now_iso(),
    };
    this.items.set(subagent_id, ref);

    const abort = new AbortController();
    const entry: RunningSubagent = { ref, abort, done: Promise.resolve(), parent_id: options.parent_id || null };
    this.running.set(subagent_id, entry);
    const done = this._run_subagent(subagent_id, options, abort, (fn) => { entry.send_input = fn; });
    entry.done = done;
    done.finally(() => {
      this.running.delete(subagent_id);
    }).catch((e) => {
      this.logger?.error("subagent unhandled rejection", { subagent_id, error: error_message(e) });
    });

    return {
      subagent_id,
      status: "started",
      message: `Subagent '${label}' started (${subagent_id})`,
    };
  }

  send_input(id: string, text: string): boolean {
    const entry = this.running.get(id);
    if (!entry?.send_input) return false;
    entry.send_input(text);
    return true;
  }

  cancel(id: string, cascade = true): boolean {
    const running = this.running.get(id);
    if (!running) return false;
    running.abort.abort();
    const prev = this.items.get(id);
    if (prev) {
      this.items.set(id, {
        ...prev,
        status: "cancelled",
        updated_at: now_iso(),
      });
    }

    if (cascade) {
      const children = [...this.running.entries()]
        .filter(([, child]) => child.parent_id === id)
        .map(([child_id]) => child_id);
      for (const child_id of children) {
        this.cancel(child_id, true);
      }
    }
    return true;
  }

  /** 특정 parent의 모든 자식 서브에이전트를 cascade cancel. */
  cancel_by_parent_id(parent_id: string): number {
    let count = 0;
    for (const [id, running] of this.running.entries()) {
      if (running.parent_id === parent_id) {
        this.cancel(id, true);
        count++;
      }
    }
    return count;
  }

  private async _run_subagent(
    id: string,
    options: SpawnSubagentOptions,
    abort: AbortController,
    register_input?: (fn: (text: string) => void) => void,
  ): Promise<void> {
    const providers = this.providers;
    if (!providers) throw new Error("providers_not_configured");
    const max_iterations = Math.max(1, Number(options.max_iterations || 15));
    const controller_provider_id = providers.get_orchestrator_provider_id();
    const executor_provider_id = resolve_executor_provider(options.provider_id || "claude_code", this.provider_caps);
    const model = options.model;
    const max_tokens = options.max_tokens ?? 4096;
    const temperature = options.temperature ?? 0.4;

    const tools = this.build_tools();
    /** headless/manual tool loop용: allowed_tools 적용 시 definitions와 execute를 필터링. */
    const headless_tools = options.allowed_tools?.length ? tools.filtered(options.allowed_tools) : tools;
    const always_skills = this.context_builder?.skills_loader.get_always_skills() || [];
    const merged_skills = [...new Set([...always_skills, ...(options.skill_names || [])])];
    const role = options.role || "";
    const role_skill = role && this.context_builder?.skills_loader.get_role_skill(role);
    const decision_ctx = { agent_id: id };
    const session_ctx = { channel: options.origin_channel || null, chat_id: options.origin_chat_id || null };
    const contextual_system = this.context_builder
      ? role_skill
        ? await this.context_builder.build_role_system_prompt(role, merged_skills, decision_ctx, session_ctx)
        : await this.context_builder.build_system_prompt(merged_skills, decision_ctx, session_ctx)
      : "";

    // 백엔드 결정 (반복문 전에 1회만)
    // P1-9: custom instance_id를 직접 조회 → built-in resolve → fallback
    const executor_backend = this.agent_backends?.get_backend(executor_provider_id as AgentBackendId)
      ?? this.agent_backends?.resolve_backend(executor_provider_id)
      ?? null;
    const backend_id: AgentBackendId = executor_backend?.id
      ?? (String(executor_provider_id).includes("codex") ? "codex_cli" : "claude_cli");

    let final_content = "";
    let stream_buffer = "";
    let last_stream_emit_at = 0;
    let last_executor_output = "";
    let loop_iteration = 0;
    let actual_finish_reason: AgentFinishReason = "stop";
    const label = options.label || options.task.slice(0, 40);
    const handoff_emitted = new Set<string>();
    this._fire(options, id, label, (s) => ({ type: "init", source: s, at: now_iso() }), backend_id);
    this.logger?.info("subagent_start", { subagent_id: id, label, backend: backend_id, max_iterations, task: options.task.slice(0, 120) });
    try {
      // skip_controller: executor 직접 호출 (Phase Loop 등 외부 orchestrator용)
      if (options.skip_controller) {
        const direct_result = await this._run_direct_executor({
          options, id, label, backend_id, executor_provider_id, executor_backend,
          contextual_system, model, max_tokens, temperature, tools, headless_tools, abort,
          stream_buffer, last_stream_emit_at, register_input,
        });
        final_content = direct_result.content;
        actual_finish_reason = direct_result.finish_reason;
      } else
      for (let iteration = 0; iteration < max_iterations; iteration += 1) {
        if (abort.signal.aborted) {
          this._update_status(id, "cancelled");
          this.logger?.info("subagent_end", { subagent_id: id, label, status: "cancelled", finish_reason: "cancelled", iterations: loop_iteration });
          this._fire(options, id, label, (s) => ({ type: "complete", source: s, at: now_iso(), finish_reason: "cancelled", content: "" }), backend_id);
          return;
        }

        const controller = await providers.run_orchestrator({
          provider_id: controller_provider_id,
          messages: [
            {
              role: "system",
              content: this._build_controller_prompt(options, id, contextual_system),
            },
            {
              role: "user",
              content: [
                `task: ${options.task}`,
                `iteration: ${iteration + 1}/${max_iterations}`,
                `last_executor_output:`,
                last_executor_output || "(none)",
              ].join("\n"),
            },
          ],
          model,
          max_tokens: Math.min(1600, max_tokens),
          temperature: 0.1,
        });
        const plan = this._parse_controller_plan(controller.content || "");
        this._fire(options, id, label, (s) => ({ type: "content_delta", source: s, at: now_iso(), text: `[plan] iteration=${iteration + 1} done=${plan.done}` }), backend_id);
        if (plan.handoffs.length > 0) {
          for (const handoff of plan.handoffs) {
            const key = `${handoff.alias}::${handoff.instruction}`;
            if (handoff_emitted.has(key)) continue;
            handoff_emitted.add(key);
            await this._announce_handoff({
              subagent_id: id,
              alias: handoff.alias,
              instruction: handoff.instruction,
              origin_channel: options.origin_channel,
              origin_chat_id: options.origin_chat_id,
            });
          }
        }
        if (plan.done) {
          final_content = plan.final_answer || last_executor_output || "completed_without_final_response";
          break;
        }
        if (!plan.executor_prompt) {
          final_content = last_executor_output || "completed_without_final_response";
          break;
        }
        loop_iteration += 1;
        await this._announce_progress({
          subagent_id: id,
          label: options.label || options.task.slice(0, 40),
          origin_channel: options.origin_channel,
          origin_chat_id: options.origin_chat_id,
          content: `turn ${loop_iteration}: executor started`,
        });

        // executor 턴: native_tool_loop 백엔드는 전체 tool loop를 내부에서 처리.
        if (executor_backend?.native_tool_loop && this.agent_backends) {
          const sa_task_id = `subagent:${id}`;
          const ref = this.items.get(id);
          const resume_session = ref?.session_id
            ? { session_id: ref.session_id, backend: executor_backend.id, created_at: ref.created_at || now_iso() }
            : (this.agent_backends.get_session_store()?.find_by_task(sa_task_id) ?? undefined);
          // 서브에이전트 정책: workspace-write + 신뢰 도구만 자동 승인 (워크스페이스 격리 보장).
          const sa_policy: RuntimeExecutionPolicy = {
            sandbox: sandbox_from_preset("workspace-write"),
          };
          const sa_hooks: AgentHooks = {
            on_event: options.hooks?.on_event,
            on_stream: async (chunk) => {
              if (abort.signal.aborted) return;
              stream_buffer += String(chunk || "");
              const now = Date.now();
              if (stream_buffer.length < 120 && now - last_stream_emit_at < 1500) return;
              await this._flush_stream_buffer({
                subagent_id: id,
                label: options.label || options.task.slice(0, 40),
                origin_channel: options.origin_channel,
                origin_chat_id: options.origin_chat_id,
                stream_buffer_ref: () => stream_buffer,
                clear_stream_buffer: () => { stream_buffer = ""; },
              });
              last_stream_emit_at = now;
            },
            pre_tool_use: create_policy_pre_hook(sa_policy),
            post_tool_use: (tool_name, _params, result, _ctx, is_error) => {
              if (tool_name === "spawn" && !is_error && options.hooks?.on_event) {
                try {
                  const parsed = JSON.parse(String(result || "{}")) as Record<string, unknown>;
                  const sid = String(parsed.subagent_id || "").trim();
                  if (sid) {
                    options.hooks.on_event({
                      type: "tool_result",
                      source: { backend: executor_backend?.id || "claude_sdk", task_id: `subagent:${id}` },
                      at: now_iso(),
                      tool_name: "spawn",
                      tool_id: "",
                      result: String(result || "").slice(0, 200),
                      params: {},
                      is_error: false,
                    });
                  }
                } catch { /* noop */ }
              }
            },
          };
          const sa_caps = executor_backend.capabilities;
          const agent_result = await this.agent_backends.run(executor_backend.id, {
            task: plan.executor_prompt,
            task_id: sa_task_id,
            system_prompt: this._build_executor_prompt(options, id, contextual_system),
            tools: tools.get_definitions() as ToolSchema[],
            tool_executors: tools.get_all(),
            runtime_policy: sa_policy,
            max_tokens,
            temperature,
            model,
            effort: "medium",
            ...(sa_caps.thinking ? { enable_thinking: true, max_thinking_tokens: 10000 } : {}),
            resume_session,
            register_send_input: register_input,
            hooks: sa_hooks,
            abort_signal: abort.signal,
            cwd: this.workspace,
            tool_context: { channel: options.origin_channel, chat_id: options.origin_chat_id, sender_id: `subagent:${id}` },
            allowed_tools: options.allowed_tools,
          });
          if (agent_result.finish_reason === "error") {
            throw new Error(String(agent_result.metadata?.error || "agent_backend_error"));
          }
          if (agent_result.finish_reason === "cancelled") {
            this._update_status(id, "cancelled");
            this.logger?.info("subagent_end", { subagent_id: id, label, status: "cancelled", finish_reason: "cancelled", iterations: loop_iteration });
            this._fire(options, id, label, (s) => ({ type: "complete", source: s, at: now_iso(), finish_reason: "cancelled", content: "" }), backend_id);
            return;
          }
          actual_finish_reason = agent_result.finish_reason;
          // 비정상 종료 경고를 결과에 추가
          const sa_warn = FINISH_REASON_WARNINGS[agent_result.finish_reason];
          if (sa_warn) {
            last_executor_output = `${agent_result.content || ""}\n\n⚠️ ${sa_warn}`.trim();
          }
          if (agent_result.session) {
            const ref = this.items.get(id);
            if (ref && !ref.session_id) {
              ref.session_id = agent_result.session.session_id;
              this.items.set(id, ref);
            }
          }
          if (!sa_warn) last_executor_output = agent_result.content || "";
        } else {
          // CLI: 기존 run_headless + 수동 tool loop
          const response = await providers.run_headless({
            provider_id: executor_provider_id,
            messages: [
              {
                role: "system",
                content: this._build_executor_prompt(options, id, contextual_system),
              },
              {
                role: "user",
                content: plan.executor_prompt,
              },
            ],
            tools: headless_tools.get_definitions(),
            model,
            max_tokens,
            temperature,
            on_stream: async (chunk) => {
              if (abort.signal.aborted) return;
              stream_buffer += String(chunk || "");
              const now = Date.now();
              if (stream_buffer.length < 120 && now - last_stream_emit_at < 1500) return;
              await this._flush_stream_buffer({
                subagent_id: id,
                label: options.label || options.task.slice(0, 40),
                origin_channel: options.origin_channel,
                origin_chat_id: options.origin_chat_id,
                stream_buffer_ref: () => stream_buffer,
                clear_stream_buffer: () => { stream_buffer = ""; },
              });
              last_stream_emit_at = now;
            },
          });
          // session_id 캡처 (첫 응답에서만)
          const sid = String(response.metadata?.session_id || response.metadata?.thread_id || "").trim();
          if (sid) {
            const ref = this.items.get(id);
            if (ref && !ref.session_id) {
              ref.session_id = sid;
              this.items.set(id, ref);
            }
          }

          const content = response.content || "";
          if (is_provider_error_reply(content)) throw new Error(content);
          await this._flush_stream_buffer({
            subagent_id: id,
            label: options.label || options.task.slice(0, 40),
            origin_channel: options.origin_channel,
            origin_chat_id: options.origin_chat_id,
            stream_buffer_ref: () => stream_buffer,
            clear_stream_buffer: () => { stream_buffer = ""; },
          });

          // executor tool-use loop: 다중 라운드 tool call 지원
          const MAX_TOOL_ROUNDS = 5;
          let current_response = response;
          const tool_messages: ChatMessage[] = [
            { role: "system", content: this._build_executor_prompt(options, id, contextual_system) },
            { role: "user", content: plan.executor_prompt },
          ];
          for (let tool_round = 0; tool_round < MAX_TOOL_ROUNDS; tool_round++) {
            const implicit = current_response.has_tool_calls
              ? []
              : parse_tool_calls_from_text(current_response.content || "");
            const effective = current_response.has_tool_calls ? current_response.tool_calls : implicit;
            if (effective.length === 0) break;

            tool_messages.push(this._assistant_tool_call_message(current_response.content, effective));
            for (const tc of effective) {
              if (abort.signal.aborted) { this._update_status(id, "cancelled"); return; }
              this._fire(options, id, label, (s) => ({ type: "tool_use", source: s, at: now_iso(), tool_name: tc.name, tool_id: tc.id, params: tc.arguments }), backend_id);
              const result = await headless_tools.execute(tc.name, tc.arguments, {
                signal: abort.signal,
                channel: options.origin_channel,
                chat_id: options.origin_chat_id,
                sender_id: `subagent:${id}`,
              });
              this._fire(options, id, label, (s) => ({ type: "tool_result", source: s, at: now_iso(), tool_name: tc.name, tool_id: tc.id, result: result.slice(0, 200) }), backend_id);
              tool_messages.push({ role: "tool", tool_call_id: tc.id, name: tc.name, content: result });
            }
            const followup = await providers.run_headless({
              provider_id: executor_provider_id,
              messages: tool_messages,
              model,
              max_tokens,
              temperature,
            });
            if (is_provider_error_reply(followup.content || "")) throw new Error(followup.content || "");
            current_response = followup;
          }
          last_executor_output = current_response.content || response.content || "";
        }
      }

      if (!final_content) {
        final_content = last_executor_output || "completed_without_final_response";
      }
      final_content = sanitize_provider_output(final_content).trim() || final_content;
      await this._flush_stream_buffer({
        subagent_id: id,
        label: options.label || options.task.slice(0, 40),
        origin_channel: options.origin_channel,
        origin_chat_id: options.origin_chat_id,
        stream_buffer_ref: () => stream_buffer,
        clear_stream_buffer: () => { stream_buffer = ""; },
      });
      this._update_status(id, "completed", undefined, final_content);
      this.logger?.info("subagent_end", { subagent_id: id, label, status: "completed", finish_reason: actual_finish_reason, iterations: loop_iteration });
      this._fire(options, id, label, (s) => ({ type: "complete", source: s, at: now_iso(), finish_reason: actual_finish_reason, content: final_content }), backend_id);
      if (options.announce !== false) {
        await this._announce_result({
          subagent_id: id,
          task: options.task,
          label: options.label || options.task.slice(0, 40),
          content: final_content,
          origin_channel: options.origin_channel,
          origin_chat_id: options.origin_chat_id,
        });
      }
    } catch (error) {
      const message = error_message(error);
      this._update_status(id, "failed", message);
      this.logger?.error("subagent_failed", { subagent_id: id, label, error: message, iterations: loop_iteration });
      this._fire(options, id, label, (s) => ({ type: "error", source: s, at: now_iso(), error: message }), backend_id);
      if (options.announce !== false) {
        await this._announce_result({
          subagent_id: id,
          task: options.task,
          label: options.label || options.task.slice(0, 40),
          content: `Error: ${message}`,
          origin_channel: options.origin_channel,
          origin_chat_id: options.origin_chat_id,
          is_error: true,
        });
      }
    } finally {
      // native_tool_loop 백엔드가 사용한 PTY 세션을 명시적으로 해제 (stdin_mode=keep 리소스 누수 방지).
      if (executor_backend) {
        void executor_backend.release_session?.(`subagent:${id}`).catch(() => {});
      }
    }
  }

  /** AgentEvent 발행 헬퍼. source를 자동 구성. */
  private _fire(
    options: SpawnSubagentOptions,
    id: string,
    label: string,
    build: (source: AgentEventSource) => AgentEvent,
    backend_id: AgentBackendId = "codex_cli",
  ): void {
    if (!options.hooks?.on_event) return;
    const source: AgentEventSource = {
      backend: backend_id,
      subagent_id: id,
      subagent_label: label,
    };
    try {
      void Promise.resolve(options.hooks.on_event(build(source)));
    } catch { /* noop */ }
  }

  private _parse_controller_plan(raw: string): ControllerPlan {
    const text = String(raw || "").trim();
    if (!text) {
      return {
        done: false,
        executor_prompt: "",
        final_answer: "",
        reason: "empty_controller_output",
        handoffs: [],
      };
    }
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const rawHandoffs = Array.isArray(parsed.handoffs) ? parsed.handoffs : [];
      const handoffs = rawHandoffs
        .map((row) => {
          const rec = (row && typeof row === "object") ? (row as Record<string, unknown>) : {};
          const alias = String(rec.alias || "").trim();
          const instruction = String(rec.instruction || "").trim();
          if (!alias || !instruction) return null;
          return { alias, instruction };
        })
        .filter((v): v is { alias: string; instruction: string } => Boolean(v));
      return {
        done: Boolean(parsed.done),
        executor_prompt: String(parsed.executor_prompt || "").trim(),
        final_answer: String(parsed.final_answer || "").trim(),
        reason: String(parsed.reason || "").trim(),
        handoffs,
      };
    } catch {
      return {
        done: false,
        executor_prompt: text,
        final_answer: "",
        reason: "non_json_controller_output",
        handoffs: [],
      };
    }
  }

  private async _announce_progress(args: {
    subagent_id: string;
    label: string;
    content: string;
    origin_channel?: string;
    origin_chat_id?: string;
  }): Promise<void> {
    if (!this.bus) return;
    const channel = String(args.origin_channel || "").trim();
    const chat_id = String(args.origin_chat_id || "").trim();
    if (!channel || !chat_id) return;
    await this.bus.publish_outbound({
      id: short_id(),
      provider: channel,
      channel,
      sender_id: `subagent:${args.subagent_id}`,
      chat_id,
      content: `📝 ${args.label}: ${args.content}`,
      at: now_iso(),
      metadata: {
        kind: "subagent_stream",
        subagent_id: args.subagent_id,
      },
    });
  }

  private async _flush_stream_buffer(args: {
    subagent_id: string;
    label: string;
    origin_channel?: string;
    origin_chat_id?: string;
    stream_buffer_ref: () => string;
    clear_stream_buffer: () => void;
  }): Promise<void> {
    const raw = args.stream_buffer_ref();
    const preview = normalize_text(raw).slice(0, 240);
    if (!preview) return;
    args.clear_stream_buffer();
    await this._announce_progress({
      subagent_id: args.subagent_id,
      label: args.label,
      origin_channel: args.origin_channel,
      origin_chat_id: args.origin_chat_id,
      content: preview,
    });
  }

  private _assistant_tool_call_message(content: string | null, tool_calls: ToolCallRequest[]): ChatMessage {
    return {
      role: "assistant",
      content: content || "",
      tool_calls: tool_calls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      })),
    };
  }

  private _update_status(id: string, status: SubagentStatus, last_error?: string, last_result?: string): void {
    const prev = this.items.get(id);
    if (!prev) return;
    this.items.set(id, {
      ...prev,
      status,
      last_error,
      last_result,
      updated_at: now_iso(),
    });
  }

  private async _announce_result(args: {
    subagent_id: string;
    task: string;
    label: string;
    content: string;
    origin_channel?: string;
    origin_chat_id?: string;
    is_error?: boolean;
  }): Promise<void> {
    if (!this.bus) return;
    const channel = String(args.origin_channel || "").trim();
    const chat_id = String(args.origin_chat_id || "").trim();
    if (!channel || !chat_id) return;
    const icon = args.is_error ? "❌" : "✅";
    await this.bus.publish_outbound({
      id: short_id(),
      provider: channel,
      channel,
      sender_id: `subagent:${args.subagent_id}`,
      chat_id,
      content: `${icon} ${args.label}: ${args.content.slice(0, 800)}`,
      at: now_iso(),
      metadata: {
        kind: "subagent_result",
        subagent_id: args.subagent_id,
      },
    });
  }

  private async _announce_handoff(args: {
    subagent_id: string;
    alias: string;
    instruction: string;
    origin_channel?: string;
    origin_chat_id?: string;
  }): Promise<void> {
    if (!this.bus) return;
    const channel = String(args.origin_channel || "").trim();
    const chat_id = String(args.origin_chat_id || "").trim();
    if (!channel || !chat_id) return;
    await this.bus.publish_outbound({
      id: short_id(),
      provider: channel,
      channel,
      sender_id: `subagent:${args.subagent_id}`,
      chat_id,
      content: `@${args.alias} ${args.instruction}`,
      at: now_iso(),
      metadata: {
        kind: "subagent_handoff",
        subagent_id: args.subagent_id,
        alias: args.alias,
      },
    });
  }

  /**
   * 서브에이전트 기본 프롬프트 조립.
   * has_contextual_system=true이면 soul/heart를 생략 (contextual_system에 실제 템플릿 포함).
   */
  private _build_subagent_prompt(options: SpawnSubagentOptions, subagent_id: string, has_contextual_system = false): string {
    const now = now_seoul_iso();
    const role = options.role || "worker";
    const persona_name = this.context_builder?.get_persona_name() || "assistant";
    const lines = [
      "# Subagent",
      `id: ${subagent_id}`,
      `now: ${now}`,
      `role: ${role}`,
      `persona: ${persona_name}`,
    ];
    if (options.soul) lines.push(`soul: ${options.soul}`);
    if (options.heart) lines.push(`heart: ${options.heart}`);
    if (!has_contextual_system && !options.soul && !options.heart) {
      lines.push(
        "soul: Calm, pragmatic, collaborative teammate.",
        "heart: Prioritize correctness, safety, and completion.",
      );
    }
    lines.push(
      `origin_channel: ${options.origin_channel || "system"}`,
      `origin_chat_id: ${options.origin_chat_id || "direct"}`,
      "",
      `You are a subagent of ${persona_name}. Stay in the team's persona at all times.`,
      "- Never mention OpenAI, GPT, Claude, Codex, Gemini, Anthropic, Google, or any AI model name as your identity.",
      "- If asked who you are, respond with your role and team affiliation only.",
      "Rules:",
      "1. Complete only the assigned task.",
      "2. Keep output concise and actionable.",
      "3. Use tools when needed, then return final summary.",
      "4. Do not start unrelated work.",
      "5. Keep routing context and return result to origin.",
      "",
      `Assigned task: ${options.task}`,
    );
    return lines.join("\n");
  }

  private _build_controller_prompt(options: SpawnSubagentOptions, subagent_id: string, contextual_system = ""): string {
    const base = this._build_subagent_prompt(options, subagent_id, !!contextual_system);
    return [
      base,
      contextual_system ? `\n# ContextBuilder System\n${contextual_system}` : "",
      "",
      "Controller mode:",
      "- You are the orchestrator LLM.",
      "- Decide next single executor turn.",
      "- Return strict JSON only.",
      "Schema:",
      '{"done":boolean,"executor_prompt":"string","final_answer":"string","reason":"string","handoffs":[{"alias":"string","instruction":"string"}]}',
      "- done=true only when the full task is complete.",
      "- executor_prompt must be compact and actionable.",
      "- If collaboration is needed, emit handoffs with @mention-ready alias and instruction.",
    ].join("\n");
  }

  private _build_executor_prompt(options: SpawnSubagentOptions, subagent_id: string, contextual_system = ""): string {
    const base = this._build_subagent_prompt(options, subagent_id, !!contextual_system);
    return [
      base,
      contextual_system ? `\n# ContextBuilder System\n${contextual_system}` : "",
      "",
      "Executor mode:",
      "- This is a clean single-turn run.",
      "- Execute only the current instruction.",
      "- Return concise result for controller consumption.",
    ].join("\n");
  }

  /** controller loop 없이 executor 백엔드를 직접 1회 호출. */
  private async _run_direct_executor(ctx: {
    options: SpawnSubagentOptions;
    id: string;
    label: string;
    backend_id: AgentBackendId;
    executor_provider_id: string;
    executor_backend: import("./agent.types.js").AgentBackend | null;
    contextual_system: string;
    model: string | undefined;
    max_tokens: number;
    temperature: number;
    tools: ReturnType<SubagentRegistry["build_tools"]>;
    headless_tools: Pick<ReturnType<SubagentRegistry["build_tools"]>, "get_definitions" | "execute" | "tool_names">;
    abort: AbortController;
    stream_buffer: string;
    last_stream_emit_at: number;
    register_input?: (fn: (text: string) => void) => void;
  }): Promise<{ content: string; finish_reason: AgentFinishReason }> {
    const { options, id, label, executor_provider_id, executor_backend, contextual_system, model, max_tokens, temperature, tools, headless_tools, abort, register_input } = ctx;
    let { stream_buffer, last_stream_emit_at } = ctx;
    const providers = this.providers!;

    const system_prompt = this._build_executor_prompt(options, id, contextual_system);
    let finish_reason: AgentFinishReason = "stop";

    if (executor_backend) {
      const agent_result = await executor_backend.run({
        task: options.task,
        system_prompt,
        model,
        max_tokens,
        max_turns: options.max_iterations || 1,
        tools: tools.get_definitions() as ToolSchema[],
        tool_executors: tools.get_all(),
        abort_signal: abort.signal,
        cwd: this.workspace,
        tool_context: { channel: options.origin_channel, chat_id: options.origin_chat_id, sender_id: `subagent:${id}` },
        allowed_tools: options.allowed_tools,
        register_send_input: register_input,
        hooks: {
          on_event: (event: import("./agent.types.js").AgentEvent) => {
            options.hooks?.on_event?.(event);
            this._fire(options, id, label, () => event, ctx.backend_id);
          },
        },
      });
      this.logger?.debug("direct_executor_result", {
        id, label, finish_reason: agent_result.finish_reason,
        content_length: agent_result.content?.length ?? 0,
        content_preview: (agent_result.content || "").slice(0, 120),
        has_error: !!agent_result.metadata?.error,
      });
      if (agent_result.finish_reason === "error") throw new Error(String(agent_result.metadata?.error || "agent_backend_error"));
      if (agent_result.finish_reason === "cancelled") return { content: "", finish_reason: "cancelled" };
      finish_reason = agent_result.finish_reason;
      const warn = FINISH_REASON_WARNINGS[finish_reason];
      const content = warn ? `${agent_result.content || ""}\n\n⚠️ ${warn}`.trim() : (agent_result.content || "");
      return { content, finish_reason };
    }

    // API fallback: run_headless
    this.logger?.debug("direct_executor_headless", {
      id, label, executor_provider_id, model, max_tokens,
      task_length: options.task.length,
    });
    const response = await providers.run_headless({
      provider_id: executor_provider_id as import("../providers/types.js").ProviderId,
      messages: [
        { role: "system", content: system_prompt },
        { role: "user", content: options.task },
      ],
      tools: headless_tools.get_definitions(),
      model,
      max_tokens,
      temperature,
      on_stream: async (chunk) => {
        if (abort.signal.aborted) return;
        stream_buffer += String(chunk || "");
        const now = Date.now();
        if (stream_buffer.length < 120 && now - last_stream_emit_at < 1500) return;
        await this._flush_stream_buffer({
          subagent_id: id, label, origin_channel: options.origin_channel, origin_chat_id: options.origin_chat_id,
          stream_buffer_ref: () => stream_buffer, clear_stream_buffer: () => { stream_buffer = ""; },
        });
        last_stream_emit_at = now;
      },
    });

    this.logger?.debug("direct_executor_headless_result", {
      id, label, content_length: response.content?.length ?? 0,
      content_preview: (response.content || "").slice(0, 120),
      finish_reason: response.finish_reason,
    });
    const content = response.content || "";
    if (is_provider_error_reply(content)) throw new Error(content);
    return { content, finish_reason: "stop" };
  }
}
