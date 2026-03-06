/** native backend용 AgentHooks 조립: 스트리밍, 승인 브리지, CD 옵저버, 이벤트 릴레이. */

import type { AgentEvent, AgentHooks, AgentBackendId } from "../agent/agent.types.js";
import type { RuntimeExecutionPolicy } from "../providers/types.js";
import type { AgentRuntimeLike } from "../agent/runtime.types.js";
import type { Logger } from "../logger.js";
import type { AppendWorkflowEventInput } from "../events/index.js";
import type { OrchestrationRequest } from "./types.js";
import { StreamBuffer } from "../channels/stream-buffer.js";
import { sanitize_stream_chunk } from "../channels/output-sanitizer.js";
import { create_cd_observer, type CDObserver } from "../agent/cd-scoring.js";
import { create_policy_pre_hook } from "../agent/tools/index.js";
import { format_tool_result_brief } from "./prompts.js";
import { safe_stringify, now_iso } from "../utils/common.js";

export type AgentHooksBuilderDeps = {
  session_cd: CDObserver;
  logger: Logger;
  process_tracker: { link_subagent(run_id: string, subagent_id: string): void } | null;
  runtime: Pick<AgentRuntimeLike, "register_approval_with_callback">;
  log_event: (input: AppendWorkflowEventInput) => void;
  streaming_config: { enabled: boolean; interval_ms: number; min_chars: number };
};

type AgentHooksOptions = {
  buffer: StreamBuffer;
  on_stream?: (chunk: string) => void;
  runtime_policy: RuntimeExecutionPolicy;
  channel_context?: { channel: string; chat_id: string };
  on_tool_block?: (block: string) => void;
  backend_id?: AgentBackendId;
  on_progress?: OrchestrationRequest["on_progress"];
  run_id?: string;
  on_agent_event?: OrchestrationRequest["on_agent_event"];
};

export function build_agent_hooks(
  deps: AgentHooksBuilderDeps,
  opts: AgentHooksOptions,
): { hooks: AgentHooks; cd: CDObserver } {
  const { buffer, on_stream, runtime_policy, channel_context, on_tool_block, backend_id, on_progress, run_id, on_agent_event } = opts;
  const cd = create_cd_observer();
  const hooks: AgentHooks = {};
  let progress_step = 0;

  hooks.on_event = (event: AgentEvent) => {
    if (on_agent_event) {
      try { on_agent_event(event); } catch { /* SSE 실패가 실행을 차단하면 안 됨 */ }
    }
    const cd_event = cd.observe(event);
    deps.session_cd.observe(event);

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
      deps.logger.info("cd_event", { indicator: cd_event.indicator, points: cd_event.points, total: cd.get_score().total });
    }

    if (on_tool_block && event.type === "tool_use") {
      on_tool_block(`${event.tool_name || "tool"}`);
      return;
    }
    if (on_tool_block && event.type === "tool_result") {
      // tool_result: 카운트 불필요. DB 로깅만 수행.
      if (run_id && channel_context) {
        const result_text = typeof event.result === "string" ? event.result : safe_stringify(event.result);
        deps.log_event({
          run_id,
          task_id: event.source.task_id || run_id,
          agent_id: backend_id || "unknown",
          provider: channel_context.channel,
          channel: channel_context.channel,
          chat_id: channel_context.chat_id,
          source: "system",
          phase: "progress",
          summary: `tool: ${event.tool_name}${event.is_error ? " (error)" : ""}`,
          detail: result_text.slice(0, 500),
          payload: { tool_name: event.tool_name, tool_id: event.tool_id, is_error: event.is_error },
        });
      }
      return;
    }

    // usage 이벤트는 로깅만 (스트림 주입 불필요)
    if (event.type === "usage") {
      deps.logger.info("agent_usage", {
        backend: event.source.backend,
        input: event.tokens.input,
        output: event.tokens.output,
        cache_read: event.tokens.cache_read,
        cost_usd: event.cost_usd,
      });
      return;
    }

    if (!on_stream) return;

    // count 모드(on_tool_block 설정)일 때: 도구/메타데이터는 스트림에 주입하지 않음.
    // 에러·인증·레이트리밋만 사용자에게 표시.
    if (on_tool_block) {
      let critical_inject: string | null = null;
      if (event.type === "error") {
        critical_inject = `\n❌ ${event.error}`;
      }
      if (event.type === "auth_request" && event.messages.length > 0) {
        critical_inject = `\n🔐 Authentication required:\n${event.messages.join("\n")}`;
      }
      if (event.type === "rate_limit" && (event.status === "rejected" || event.status === "allowed_warning")) {
        const reset = event.resets_at ? ` (resets ${new Date(event.resets_at * 1000).toISOString().slice(11, 19)})` : "";
        critical_inject = event.status === "rejected"
          ? `\n⚠️ Rate limit exceeded${reset}`
          : `\n⚠️ Rate limit warning (${Math.round((event.utilization ?? 0) * 100)}%)${reset}`;
      }
      if (critical_inject) {
        buffer.append(critical_inject);
        const flushed = buffer.flush();
        if (flushed) {
          try { on_stream(flushed); } catch { /* stream failure 무시 */ }
        }
      }
      return;
    }

    // inline 모드: 모든 이벤트를 스트림에 주입
    let inject: string | null = null;

    if (event.type === "tool_use") {
      inject = `\n▸ \`${event.tool_name}\``;
    }
    if (event.type === "tool_result") {
      const result_text = typeof event.result === "string" ? event.result : safe_stringify(event.result);
      const brief = format_tool_result_brief(result_text, 150);
      inject = event.is_error ? ` ✗ ${brief}` : ` → ${brief}`;
      if (run_id && channel_context) {
        deps.log_event({
          run_id,
          task_id: event.source.task_id || run_id,
          agent_id: backend_id || "unknown",
          provider: channel_context.channel,
          channel: channel_context.channel,
          chat_id: channel_context.chat_id,
          source: "system",
          phase: "progress",
          summary: `tool: ${event.tool_name}${event.is_error ? " (error)" : ""}`,
          detail: result_text.slice(0, 500),
          payload: { tool_name: event.tool_name, tool_id: event.tool_id, is_error: event.is_error },
        });
      }
    }
    if (event.type === "task_lifecycle") {
      const label = event.status === "started" ? "▶" : event.status === "progress" ? "⋯" : event.status === "completed" ? "✓" : "✗";
      inject = `\n${label} ${event.description || event.summary || event.sdk_task_id}`;
    }
    if (event.type === "auth_request" && event.messages.length > 0) {
      inject = `\n🔐 Authentication required:\n${event.messages.join("\n")}`;
    }
    if (event.type === "rate_limit" && (event.status === "rejected" || event.status === "allowed_warning")) {
      const reset = event.resets_at ? ` (resets ${new Date(event.resets_at * 1000).toISOString().slice(11, 19)})` : "";
      inject = event.status === "rejected"
        ? `\n⚠️ Rate limit exceeded${reset}`
        : `\n⚠️ Rate limit warning (${Math.round((event.utilization ?? 0) * 100)}%)${reset}`;
    }
    if (event.type === "error") {
      inject = `\n❌ ${event.error}`;
    }
    if (event.type === "tool_summary" && event.summary) {
      inject = `\n${event.summary}`;
    }
    if (event.type === "compact_boundary") {
      inject = "\n📦 컨텍스트 압축 중...";
    }

    if (inject) {
      buffer.append(inject);
      const flushed = buffer.flush();
      if (flushed) {
        try { on_stream(flushed); } catch { /* stream failure 무시 */ }
      }
    }
  };

  const stream_handler = create_stream_handler(deps.streaming_config, buffer, on_stream);
  if (stream_handler) hooks.on_stream = stream_handler;

  const approval = runtime_policy?.sandbox?.approval || "auto-approve";
  if (channel_context) {
    if (approval === "auto-approve") {
      // auto-approve: 자동 수락하되 이벤트 기록 (silent failure 방지)
      hooks.on_approval = async (request) => {
        deps.logger.info("approval_auto_accepted", { tool: request.tool_name, type: request.type });
        return "accept";
      };
    } else {
      hooks.on_approval = async (request) => {
        deps.logger.info("approval_bridge_request", { tool: request.tool_name, type: request.type });
        const { decision } = deps.runtime.register_approval_with_callback(
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
  }

  if (runtime_policy) {
    hooks.pre_tool_use = create_policy_pre_hook(runtime_policy);
  }

  hooks.post_tool_use = (tool_name, params, result, _context, is_error) => {
    deps.session_cd.observe({
      type: "tool_result",
      source: { backend: backend_id || "claude_sdk" },
      at: now_iso(),
      tool_name,
      tool_id: "",
      result: String(result || "").slice(0, 200),
      params,
      is_error,
    });
    if (tool_name === "spawn" && run_id && !is_error) {
      try {
        const parsed = JSON.parse(String(result || "{}")) as Record<string, unknown>;
        const sid = String(parsed.subagent_id || "").trim();
        if (sid) deps.process_tracker?.link_subagent(run_id, sid);
      } catch { /* noop */ }
    }
  };

  return { hooks, cd };
}

// ── 스트리밍 헬퍼 ──

export function create_stream_handler(
  config: { enabled: boolean; interval_ms: number; min_chars: number },
  buffer: StreamBuffer,
  on_stream?: (chunk: string) => void,
): ((chunk: string) => Promise<void>) | undefined {
  if (!config.enabled || !on_stream) return undefined;

  return async (chunk: string) => {
    const sanitized = sanitize_stream_chunk(String(chunk || ""));
    if (!sanitized) return;

    buffer.append(sanitized);

    if (buffer.should_flush(config.interval_ms, config.min_chars)) {
      const content = buffer.flush();
      if (content) {
        try { on_stream(content); } catch { /* stream callback failure must not break provider loop */ }
      }
    }
  };
}

export function flush_remaining(buffer: StreamBuffer, on_stream?: (chunk: string) => void): void {
  if (!on_stream) return;
  const content = buffer.flush();
  if (content) {
    try { on_stream(content); } catch { /* stream callback failure must not break orchestration */ }
  }
}

/** 실행 정보를 로깅. 사용자 스트림에는 주입하지 않음. */
export function emit_execution_info(
  _buffer: StreamBuffer,
  _on_stream: ((chunk: string) => void) | undefined,
  mode: string,
  executor: string,
  logger?: { debug(msg: string, meta?: Record<string, unknown>): void },
): void {
  logger?.debug("execution_info", { mode, executor });
}
