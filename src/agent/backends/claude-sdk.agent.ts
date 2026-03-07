import { createRequire } from "node:module";
import type {
  AgentBackend,
  AgentBackendId,
  AgentEvent,
  AgentEventSource,
  AgentRunOptions,
  AgentRunResult,
  AgentSession,
  ApprovalBridgeCallback,
  ApprovalBridgeRequest,
  BackendCapabilities,
} from "../agent.types.js";
import type { PreToolHook, PostToolHook } from "../tools/types.js";
import type { LlmUsage, ModelUsageEntry } from "../../providers/types.js";
import { now_iso, error_message, short_id, safe_stringify, swallow } from "../../utils/common.js";
import { sandbox_to_sdk_permission, sdk_result_subtype_to_finish_reason } from "./convert.js";
import { sandbox_from_preset } from "../../providers/types.js";
import { create_sdk_tool_server } from "./sdk-tool-bridge.js";
import { fire } from "./tool-loop-helpers.js";

/** SDK Query 객체. AsyncIterable + lifecycle 메서드. */
type SdkQuery = AsyncIterable<Record<string, unknown>> & {
  close?: () => void | Promise<void>;
  interrupt?: () => Promise<void>;
  streamInput?: (input: AsyncIterable<Record<string, unknown>>) => Promise<void>;
};

/** `@anthropic-ai/claude-agent-sdk` query() 함수의 최소 타입 정의. */
type SdkQueryFn = (args: {
  prompt: string;
  options?: Record<string, unknown>;
}) => SdkQuery;

/**
 * Claude Agent SDK를 통해 Claude CLI를 네이티브로 제어하는 백엔드.
 * SDK가 내부에서 tool loop를 완전히 처리 (native_tool_loop=true).
 *
 * optional dependency — `@anthropic-ai/claude-agent-sdk` 미설치 시 is_available()=false.
 */
export class ClaudeSdkAgent implements AgentBackend {
  readonly id: AgentBackendId;
  readonly native_tool_loop = true;
  readonly supports_resume = true;
  readonly capabilities: BackendCapabilities = {
    approval: true,
    structured_output: true,
    thinking: true,
    budget_tracking: true,
    tool_filtering: true,
    tool_result_events: true,
    send_input: true,
    tool_executors: true,
  };

  private sdk_query: SdkQueryFn | null = null;
  private checked = false;
  private _available = false;

  constructor(private readonly config?: {
    id?: string;
    cwd?: string;
    model?: string;
    max_budget_usd?: number;
  }) {
    this.id = config?.id ?? "claude_sdk";
  }

  is_available(): boolean {
    if (!this.checked) {
      this.checked = true;
      try {
        const req = createRequire(import.meta.url);
        req.resolve("@anthropic-ai/claude-agent-sdk");
        this._available = true;
      } catch {
        this._available = false;
      }
    }
    return this._available;
  }

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const query = await this._load_query();
    if (!query) {
      return this._error_result("@anthropic-ai/claude-agent-sdk is not installed", 0);
    }

    const emit = options.hooks?.on_event;
    const source: AgentEventSource = { backend: this.id, task_id: options.task_id };
    let session_id: string | undefined;
    let result_content = "";
    let turn_text = "";
    let tool_calls_count = 0;
    let total_input = 0;
    let total_output = 0;
    let total_cache_read = 0;
    let total_cache_creation = 0;
    let result_cost_usd: number | undefined;
    let result_model_usage: Record<string, ModelUsageEntry> | undefined;
    let result_finish_reason: import("../agent.types.js").AgentFinishReason | undefined;
    let result_parsed_output: unknown;
    const extra_metadata: Record<string, unknown> = {};

    const sandbox = options.runtime_policy?.sandbox ?? sandbox_from_preset("full-auto");
    const { permission_mode, dangerous_skip } = sandbox_to_sdk_permission(sandbox);
    const sdk_options: Record<string, unknown> = {
      permissionMode: permission_mode,
    };

    const effective_cwd = options.cwd || this.config?.cwd;
    if (effective_cwd) sdk_options.cwd = effective_cwd;
    if (options.system_prompt) sdk_options.systemPrompt = options.system_prompt;
    if (options.max_turns) sdk_options.maxTurns = options.max_turns;
    if (dangerous_skip) sdk_options.allowDangerouslySkipPermissions = true;
    if (options.resume_session?.session_id) sdk_options.resume = options.resume_session.session_id;

    // per-run 모델 > config 기본값
    sdk_options.model = options.model || this.config?.model;
    if (options.fallback_model) sdk_options.fallbackModel = options.fallback_model;
    if (this.config?.max_budget_usd || options.max_budget_usd) {
      sdk_options.maxBudgetUsd = options.max_budget_usd ?? this.config?.max_budget_usd;
    }

    // thinking: enable_thinking=true면 기본 budget 할당, 명시 값 우선
    if (options.enable_thinking || options.max_thinking_tokens) {
      sdk_options.maxThinkingTokens = options.max_thinking_tokens || 10000;
    }

    // 도구 필터링
    if (options.allowed_tools) sdk_options.allowedTools = options.allowed_tools;
    if (options.disallowed_tools) sdk_options.disallowedTools = options.disallowed_tools;

    // 구조화된 출력 — SDK는 { type: 'json_schema', schema: ... } 래핑 필요
    if (options.structured_output) {
      sdk_options.outputFormat = { type: "json_schema", schema: options.structured_output };
    }

    // 환경변수 + 설정 소스
    if (options.env) sdk_options.env = options.env;
    if (options.settings_sources) sdk_options.settingSources = options.settings_sources;

    // MCP 서버 → SDK mcpServers 형식 (실제 config만 사용)
    const mcp_servers: Record<string, unknown> = {};
    if (options.mcp_server_configs) {
      Object.assign(mcp_servers, options.mcp_server_configs);
    }

    // 등록 도구 → in-process MCP 서버로 래핑 (SDK가 네이티브 호출)
    // SDK가 도구명에 mcp__<name>__ 접두사를 부여하므로, 서버 이름을 최소화
    if (options.tool_executors?.length) {
      const tool_ctx = { task_id: options.task_id, signal: options.abort_signal, ...options.tool_context };
      const tool_server = await create_sdk_tool_server("builtin", options.tool_executors, tool_ctx);
      if (tool_server) mcp_servers["builtin"] = tool_server;
    }

    if (Object.keys(mcp_servers).length > 0) {
      sdk_options.mcpServers = mcp_servers;
    }

    // SDK hooks 구성 (Approval + PostToolUse + PostToolUseFailure)
    const sdk_hooks: Record<string, unknown[]> = {};

    const on_approval = options.hooks?.on_approval;
    const pre_tool = options.hooks?.pre_tool_use;
    if (on_approval || pre_tool) {
      const pre_tool_ctx = { task_id: options.task_id, signal: options.abort_signal, ...options.tool_context };
      sdk_hooks.PreToolUse = [{
        matcher: ".*",
        hooks: [_create_pre_tool_hook(on_approval, pre_tool, emit, source, pre_tool_ctx)],
      }];
    }

    const post_tool = options.hooks?.post_tool_use;
    if (post_tool) {
      const hook_ctx = { task_id: options.task_id, signal: options.abort_signal, ...options.tool_context };
      sdk_hooks.PostToolUse = [{
        matcher: ".*",
        hooks: [_create_post_tool_hook(post_tool, emit, source, hook_ctx)],
      }];
      sdk_hooks.PostToolUseFailure = [{
        matcher: ".*",
        hooks: [_create_post_tool_failure_hook(post_tool, emit, source, hook_ctx)],
      }];
    }

    if (Object.keys(sdk_hooks).length > 0) {
      sdk_options.hooks = sdk_hooks;
    }

    // AbortController → SDK에 전달하여 도구 실행 중에도 abort 가능
    const abort_controller = new AbortController();
    sdk_options.abortController = abort_controller;

    fire(emit, { type: "init", source, at: now_iso() });

    const sdk_query_instance = query({ prompt: options.task, options: sdk_options });

    // abort → interrupt() (graceful) → abort_controller (강제)
    const abort_relay = () => {
      swallow(sdk_query_instance.interrupt?.()!);
      abort_controller.abort();
    };
    if (options.abort_signal) {
      if (options.abort_signal.aborted) abort_controller.abort();
      else options.abort_signal.addEventListener("abort", abort_relay, { once: true });
    }

    if (options.register_send_input && sdk_query_instance.streamInput) {
      const si = sdk_query_instance.streamInput.bind(sdk_query_instance);
      options.register_send_input((text) => {
        const msg = {
          type: "user" as const,
          message: { role: "user" as const, content: text },
          parent_tool_use_id: null,
          session_id: session_id || "",
        };
        swallow(si((async function* () { yield msg; })()));
      });
    }

    try {
      for await (const message of sdk_query_instance) {
        if (abort_controller.signal.aborted) {
          fire(emit, { type: "complete", source, at: now_iso(), finish_reason: "cancelled", content: result_content || undefined });
          return {
            content: result_content || null,
            session: this._build_session(session_id),
            tool_calls_count,
            usage: this._build_usage(total_input, total_output, total_cache_read, total_cache_creation),
            finish_reason: "cancelled",
            metadata: {},
          };
        }

        // init: session_id 캡처
        if (message.type === "system" && message.subtype === "init") {
          session_id = String(message.session_id || "");
          continue;
        }

        // status: compacting → 컨텍스트 압축 진행 중 알림
        if (message.type === "system" && message.subtype === "status" && message.status === "compacting") {
          fire(emit, {
            type: "compact_boundary", source, at: now_iso(),
            trigger: "auto", pre_tokens: 0,
          });
          if (options.hooks?.on_stream) {
            swallow(options.hooks.on_stream("\n📦 컨텍스트 압축 중..."));
          }
          continue;
        }

        // compact_boundary: 컨텍스트 압축 감지
        if (message.type === "system" && message.subtype === "compact_boundary") {
          const meta = message.compact_metadata as { trigger?: string; pre_tokens?: number } | undefined;
          fire(emit, {
            type: "compact_boundary", source, at: now_iso(),
            trigger: (meta?.trigger === "manual" ? "manual" : "auto"),
            pre_tokens: Number(meta?.pre_tokens || 0),
          });
          continue;
        }

        // auth_status: 인증 흐름 감지 (URL 포함 가능)
        if (message.type === "auth_status") {
          const auth = message as Record<string, unknown>;
          const output = Array.isArray(auth.output) ? (auth.output as string[]) : [];
          const error_msg = auth.error as string | undefined;
          fire(emit, {
            type: "auth_request", source, at: now_iso(),
            messages: error_msg ? [...output, `Error: ${error_msg}`] : output,
            is_error: Boolean(error_msg),
          });
          if (error_msg) {
            result_finish_reason = "error";
            fire(emit, {
              type: "error", source, at: now_iso(),
              error: `auth_failed: ${error_msg}`, code: "auth_failed",
            });
          }
          continue;
        }

        // rate_limit_event: 레이트 리밋 감지
        if (message.type === "rate_limit_event") {
          const info = message.rate_limit_info as {
            status?: string; resetsAt?: number; utilization?: number;
          } | undefined;
          if (info) {
            const status = info.status === "allowed_warning" ? "allowed_warning"
              : info.status === "rejected" ? "rejected" : "allowed";
            fire(emit, {
              type: "rate_limit", source, at: now_iso(),
              status: status as "allowed" | "allowed_warning" | "rejected",
              resets_at: info.resetsAt,
              utilization: info.utilization,
            });
          }
          continue;
        }

        // task lifecycle: 서브에이전트 시작/진행/완료 이벤트
        if (message.type === "system" && (
          message.subtype === "task_started" || message.subtype === "task_progress" || message.subtype === "task_notification"
        )) {
          const sdk_task_id = String(message.task_id || "");
          const status_map: Record<string, "started" | "progress" | "completed" | "failed" | "stopped"> = {
            task_started: "started", task_progress: "progress",
            completed: "completed", failed: "failed", stopped: "stopped",
          };
          const status = message.subtype === "task_notification"
            ? (status_map[String(message.status)] || "completed")
            : status_map[message.subtype as string] || "progress";
          const task_usage = message.usage as { total_tokens?: number; tool_uses?: number; duration_ms?: number } | undefined;
          fire(emit, {
            type: "task_lifecycle", source, at: now_iso(),
            sdk_task_id, status,
            description: String(message.description || message.summary || ""),
            summary: message.subtype === "task_notification" ? String(message.summary || "") : undefined,
            task_usage: task_usage?.total_tokens ? {
              total_tokens: Number(task_usage.total_tokens),
              tool_uses: Number(task_usage.tool_uses || 0),
              duration_ms: Number(task_usage.duration_ms || 0),
            } : undefined,
          });
          continue;
        }

        // tool_progress: 장시간 도구 실행 진행 상태
        if (message.type === "tool_progress") {
          const tool_name = String(message.tool_name || "tool");
          const elapsed = Number(message.elapsed_time_seconds || 0);
          if (options.hooks?.on_stream && elapsed > 0) {
            const label = `\n⏳ ${tool_name} (${Math.round(elapsed)}s)`;
            swallow(options.hooks.on_stream(label));
          }
          continue;
        }

        // tool_use_summary: 연속 도구 호출 요약
        if (message.type === "tool_use_summary") {
          fire(emit, {
            type: "tool_summary", source, at: now_iso(),
            summary: String(message.summary || ""),
            tool_use_ids: (message.preceding_tool_use_ids as string[]) || [],
          });
          continue;
        }

        // result: Success/Error subtype 분기 + 비용/모델별 usage 추출
        if (message.type === "result") {
          const subtype = String(message.subtype || "success");
          result_finish_reason = sdk_result_subtype_to_finish_reason(subtype);
          result_content = _stringify_for_render(message.result);
          if (message.structured_output !== undefined) {
            result_parsed_output = message.structured_output;
          }
          if (typeof message.total_cost_usd === "number") {
            result_cost_usd = message.total_cost_usd;
          }
          const raw_mu = message.modelUsage as Record<string, Record<string, unknown>> | undefined;
          if (raw_mu && typeof raw_mu === "object") {
            result_model_usage = {};
            for (const [model, mu] of Object.entries(raw_mu)) {
              result_model_usage[model] = {
                input_tokens: Number(mu.inputTokens || 0),
                output_tokens: Number(mu.outputTokens || 0),
                cache_read_input_tokens: Number(mu.cacheReadInputTokens || 0),
                cache_creation_input_tokens: Number(mu.cacheCreationInputTokens || 0),
                cost_usd: Number(mu.costUSD || 0),
              };
            }
          }
          // 에러 메타데이터 수집
          const result_meta: Record<string, unknown> = {};
          if (message.duration_ms) result_meta.duration_ms = message.duration_ms;
          if (message.duration_api_ms) result_meta.duration_api_ms = message.duration_api_ms;
          if (message.num_turns) result_meta.num_turns = message.num_turns;
          const errors = message.errors as string[] | undefined;
          if (errors?.length) result_meta.errors = errors;
          const denials = message.permission_denials as unknown[] | undefined;
          if (denials?.length) result_meta.permission_denials = denials;
          // SDK 최종 집계 usage 사용 (per-message 누적보다 정확)
          const result_usage = message.usage as {
            input_tokens?: number; output_tokens?: number;
            cache_creation_input_tokens?: number; cache_read_input_tokens?: number;
          } | undefined;
          if (result_usage) {
            total_input = Number(result_usage.input_tokens || 0) || total_input;
            total_output = Number(result_usage.output_tokens || 0) || total_output;
            total_cache_read = Number(result_usage.cache_read_input_tokens || 0) || total_cache_read;
            total_cache_creation = Number(result_usage.cache_creation_input_tokens || 0) || total_cache_creation;
          }

          Object.assign(extra_metadata, result_meta);

          fire(emit, {
            type: "complete", source, at: now_iso(),
            finish_reason: result_finish_reason, content: result_content,
          });
          continue;
        }

        // assistant 메시지의 에러 필드 — 문자열 리터럴 유니온 (authentication_failed, billing_error, rate_limit 등)
        if (message.type === "assistant" && message.error) {
          const err_type = String(message.error);
          result_finish_reason = "error";
          fire(emit, {
            type: "error", source, at: now_iso(),
            error: err_type, code: `sdk:${err_type}`,
          });
          continue;
        }

        // resume 시 재생 메시지 건너뛰기 (중복 카운팅/스트리밍 방지)
        if (message.isReplay === true) continue;

        // SDKAssistantMessage → content blocks에서 tool_use + text 추출
        if (message.type === "assistant" && !message.error) {
          const beta_msg = message.message as Record<string, unknown> | undefined;
          const blocks = Array.isArray(beta_msg?.content) ? beta_msg!.content as Record<string, unknown>[] : [];
          for (const block of blocks) {
            if (block.type === "tool_use") {
              tool_calls_count++;
              fire(emit, {
                type: "tool_use", source, at: now_iso(),
                tool_name: String(block.name || "unknown"),
                tool_id: String(block.id || short_id(8)),
                params: (block.input as Record<string, unknown>) ?? {},
              });
            } else if (block.type === "text" && block.text) {
              const text = String(block.text);
              turn_text += text;
              fire(emit, { type: "content_delta", source, at: now_iso(), text });
              if (options.hooks?.on_stream) {
                swallow(options.hooks.on_stream(text));
              }
            }
          }
          // last-turn-wins: 텍스트가 있는 마지막 어시스턴트 턴만 최종 응답으로 사용.
          // 중간 턴의 "사고 과정" 텍스트는 스트리밍(content_delta)으로만 전달.
          if (turn_text) result_content = turn_text;
          turn_text = "";
          continue;
        }

        // usage 누적 (캐시 토큰 포함)
        const msg_usage = message.usage as {
          input_tokens?: number; output_tokens?: number;
          cache_creation_input_tokens?: number; cache_read_input_tokens?: number;
        } | undefined;
        if (msg_usage) {
          total_input += Number(msg_usage.input_tokens || 0);
          total_output += Number(msg_usage.output_tokens || 0);
          total_cache_read += Number(msg_usage.cache_read_input_tokens || 0);
          total_cache_creation += Number(msg_usage.cache_creation_input_tokens || 0);
        }

        // content streaming + content_delta 이벤트
        if (message.content) {
          const text = safe_stringify(message.content);
          fire(emit, { type: "content_delta", source, at: now_iso(), text });
          if (options.hooks?.on_stream) {
            swallow(options.hooks.on_stream(text));
          }
        }
      }

      if (total_input || total_output) {
        fire(emit, {
          type: "usage", source, at: now_iso(),
          tokens: {
            input: total_input, output: total_output,
            cache_read: total_cache_read || undefined,
            cache_creation: total_cache_creation || undefined,
          },
          cost_usd: result_cost_usd,
        });
      }

      return {
        content: result_content || null,
        session: this._build_session(session_id),
        tool_calls_count,
        usage: this._build_usage(total_input, total_output, total_cache_read, total_cache_creation, result_cost_usd, result_model_usage),
        finish_reason: result_finish_reason ?? (result_content ? "stop" : "error"),
        parsed_output: result_parsed_output,
        metadata: { ...(session_id ? { session_id } : {}), ...extra_metadata },
      };
    } catch (error) {
      const msg = error_message(error);
      fire(emit, { type: "error", source, at: now_iso(), error: msg });
      return this._error_result(msg, tool_calls_count);
    } finally {
      options.abort_signal?.removeEventListener("abort", abort_relay);
      swallow(sdk_query_instance.close?.());
    }
  }

  private _build_session(session_id?: string): AgentSession | null {
    if (!session_id) return null;
    return { session_id, backend: this.id, created_at: now_iso() };
  }

  private _build_usage(
    input: number, output: number,
    cache_read = 0, cache_creation = 0,
    cost_usd?: number, model_usage?: Record<string, ModelUsageEntry>,
  ): LlmUsage {
    if (!input && !output) return {};
    return {
      prompt_tokens: input || undefined,
      completion_tokens: output || undefined,
      total_tokens: (input + output) || undefined,
      cache_read_input_tokens: cache_read || undefined,
      cache_creation_input_tokens: cache_creation || undefined,
      total_cost_usd: cost_usd,
      model_usage: model_usage && Object.keys(model_usage).length > 0 ? model_usage : undefined,
    };
  }

  private _error_result(message: string, tool_calls_count: number): AgentRunResult {
    return {
      content: `Error: ${message}`,
      session: null,
      tool_calls_count,
      usage: {},
      finish_reason: "error",
      metadata: { error: message },
    };
  }

  private async _load_query(): Promise<SdkQueryFn | null> {
    if (this.sdk_query) return this.sdk_query;
    try {
      const SDK_MODULE = "@anthropic-ai/claude-agent-sdk";
      const mod = await import(/* webpackIgnore: true */ SDK_MODULE);
      this.sdk_query = mod.query as SdkQueryFn;
      this._available = true;
      this.checked = true;
      return this.sdk_query;
    } catch {
      this._available = false;
      this.checked = true;
      return null;
    }
  }
}

/** pre_tool_use + on_approval → SDK PreToolUse HookCallback 통합. pre_tool이 block하면 deny. */
function _create_pre_tool_hook(
  on_approval: ApprovalBridgeCallback | undefined,
  pre_tool: PreToolHook | undefined,
  emit: EmitFn,
  source: AgentEventSource,
  tool_context?: import("../tools/types.js").ToolExecutionContext,
) {
  return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const tool_name = String(input.tool_name ?? input.name ?? "unknown");
    const tool_input = (input.tool_input ?? input.input ?? {}) as Record<string, unknown>;

    // pre_tool_use 훅 실행 → deny면 즉시 block
    let updated_input: Record<string, unknown> | undefined;
    if (pre_tool) {
      const decision = await pre_tool(tool_name, tool_input, tool_context);
      if (decision.permission === "deny") {
        return _deny_hook(decision.reason || "policy_denied");
      }
      if (decision.updated_params) updated_input = decision.updated_params;
    }

    // on_approval 훅 실행
    if (on_approval) {
      const request: ApprovalBridgeRequest = {
        request_id: short_id(),
        type: "tool_use",
        detail: `tool: ${tool_name}`,
        tool_name,
        tool_input: Object.keys(tool_input).length > 0 ? tool_input : undefined,
      };
      if (emit) {
        swallow(emit({
          type: "approval_request", source, at: now_iso(), request,
        }));
      }
      const decision = await on_approval(request);
      if (decision === "deny" || decision === "cancel") {
        return _deny_hook("approval_denied");
      }
    }

    // updated_params가 있으면 SDK의 updatedInput으로 전달 (permissionDecision: "allow" 필수)
    if (updated_input) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: updated_input,
        },
      };
    }
    return {};
  };
}

/** SDK PreToolUse deny 응답. hookSpecificOutput.permissionDecision 사용. */
function _deny_hook(reason: string): Record<string, unknown> {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

/** 객체/배열을 렌더링 가능한 문자열로 변환. 마크다운 코드블록으로 래핑. */
function _stringify_for_render(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  const text = safe_stringify(value);
  return text.startsWith("{") || text.startsWith("[") ? "```json\n" + text + "\n```" : text;
}

/**
 * SDK hook의 tool_response에서 텍스트 추출.
 * MCP 프로토콜 형식 `{ content: [{ type: "text", text }] }` 또는 plain string 모두 처리.
 */
function _extract_tool_response_text(response: unknown): string {
  if (response == null) return "";
  if (typeof response === "string") return response;
  if (typeof response === "object") {
    const rec = response as Record<string, unknown>;
    // MCP content blocks: { content: [{ type: "text", text: "..." }] }
    if (Array.isArray(rec.content)) {
      const texts = (rec.content as Record<string, unknown>[])
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string);
      if (texts.length > 0) return texts.join("\n");
    }
    // content가 단일 문자열인 경우
    if (typeof rec.content === "string") return rec.content;
    // text 필드
    if (typeof rec.text === "string") return rec.text;
  }
  return safe_stringify(response);
}

type EmitFn = ((event: AgentEvent) => void | Promise<void>) | undefined;

/** PostToolHook → SDK PostToolUse hook 변환. tool_result 이벤트 발행 + 콜백 호출. */
function _create_post_tool_hook(
  post_tool: PostToolHook,
  emit: EmitFn,
  source: AgentEventSource,
  ctx?: import("../tools/types.js").ToolExecutionContext,
) {
  return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const tool_name = String(input.tool_name ?? "unknown");
    const tool_id = String(input.tool_use_id ?? "");
    const tool_input = (input.tool_input ?? {}) as Record<string, unknown>;
    const tool_response = _extract_tool_response_text(input.tool_response);

    if (emit) {
      swallow(emit({
        type: "tool_result", source, at: now_iso(),
        tool_name, tool_id, result: tool_response,
        params: tool_input,
      }));
    }

    await post_tool(tool_name, tool_input, tool_response, ctx, false);
    return {};
  };
}

/** PostToolHook → SDK PostToolUseFailure hook 변환. is_error=true로 콜백 호출. */
function _create_post_tool_failure_hook(
  post_tool: PostToolHook,
  emit: EmitFn,
  source: AgentEventSource,
  ctx?: import("../tools/types.js").ToolExecutionContext,
) {
  return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const tool_name = String(input.tool_name ?? "unknown");
    const tool_id = String(input.tool_use_id ?? "");
    const tool_input = (input.tool_input ?? {}) as Record<string, unknown>;
    const error_msg = _extract_tool_response_text(input.error) || "unknown error";

    if (emit) {
      swallow(emit({
        type: "tool_result", source, at: now_iso(),
        tool_name, tool_id, result: error_msg, is_error: true,
        params: tool_input,
      }));
    }

    await post_tool(tool_name, tool_input, error_msg, ctx, true);
    return {};
  };
}
