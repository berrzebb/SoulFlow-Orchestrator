/** 도구 실행 핸들러: providers legacy 경로에서 tool_calls 배열을 처리. */

import type { ToolExecutionContext } from "../agent/tools/types.js";
import type { AgentEvent } from "../agent/agent.types.js";
import type { Logger } from "../logger.js";
import type { AppendWorkflowEventInput } from "../events/index.js";
import { StreamBuffer } from "../channels/stream-buffer.js";
import { format_tool_label, format_tool_block } from "./prompts.js";
import { now_iso, error_message } from "../utils/common.js";

export type ToolCallEntry = { name: string; arguments?: Record<string, unknown> };
export type ToolCallState = { suppress: boolean; file_requested?: boolean; done_sent?: boolean; tool_count: number };

type ToolCallStreamContext = {
  buffer: StreamBuffer;
  on_stream?: (chunk: string) => void;
  on_tool_block?: (block: string) => void;
  on_tool_event?: (event: AgentEvent) => void;
  log_ctx?: { run_id: string; agent_id: string; provider: string; chat_id: string };
};

export type ToolCallHandlerDeps = {
  max_tool_result_chars: number;
  logger: Logger;
  execute_tool: (name: string, params: Record<string, unknown>, ctx?: ToolExecutionContext) => Promise<string>;
  log_event: (input: AppendWorkflowEventInput) => void;
};

export function create_tool_call_handler(
  deps: ToolCallHandlerDeps,
  tool_ctx: ToolExecutionContext,
  state: ToolCallState,
  stream_ctx?: ToolCallStreamContext,
): (args: { tool_calls: ToolCallEntry[] }) => Promise<string> {
  const max_chars = deps.max_tool_result_chars;
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
      const emit_result = (result_text: string, is_error: boolean) => {
        const truncated = is_error ? result_text : truncate_tool_result(result_text, max_chars);
        if (stream_ctx?.on_tool_event) {
          stream_ctx.on_tool_event({
            type: "tool_result",
            source: { backend: "claude_cli" as const, task_id: tool_ctx.task_id },
            at: now_iso(),
            tool_name: tc.name, tool_id: "",
            result: truncated, params: tc.arguments, is_error,
          });
        }
        if (stream_ctx?.log_ctx) {
          const lc = stream_ctx.log_ctx;
          deps.log_event({
            run_id: lc.run_id, task_id: tool_ctx.task_id || lc.run_id,
            agent_id: lc.agent_id, provider: lc.provider, channel: lc.provider, chat_id: lc.chat_id,
            source: "system", phase: "progress",
            summary: `tool: ${tc.name}${is_error ? " (error)" : ""}`,
            detail: truncated.slice(0, 500),
            payload: { tool_name: tc.name, is_error },
          });
        }
        const block = format_tool_block(label, result_text, is_error);
        if (stream_ctx?.on_tool_block) {
          stream_ctx.on_tool_block(block);
        } else if (stream_ctx?.on_stream) {
          stream_ctx.buffer.append(block);
          flush_stream();
        }
        return truncated;
      };

      try {
        deps.logger.debug("tool_call", { name: tc.name, args: tc.arguments });
        const result = await deps.execute_tool(tc.name, tc.arguments || {}, tool_ctx);
        state.tool_count += 1;
        deps.logger.debug("tool_result", { name: tc.name, result: String(result).slice(0, 200) });
        const truncated = emit_result(result, false);
        outputs.push(`[tool:${tc.name}] ${truncated}`);
      } catch (e) {
        state.tool_count += 1;
        const err_msg = error_message(e);
        deps.logger.debug("tool_error", { name: tc.name, error: err_msg });
        emit_result(err_msg, true);
        outputs.push(`[tool:${tc.name}] error: ${err_msg}`);
      }
    }
    return outputs.join("\n");
  };
}

// ── 유틸 ──

function truncate_tool_result(result: string, max_chars: number): string {
  const limit = Math.max(100, max_chars);
  if (result.length <= limit) return result;
  const half = Math.floor((limit - 40) / 2);
  return `${result.slice(0, half)}\n...[truncated ${result.length - limit} chars]...\n${result.slice(-half)}`;
}

function is_done_phase(args: Record<string, unknown>): boolean {
  return String(args.phase || "").trim().toLowerCase() === "done";
}
