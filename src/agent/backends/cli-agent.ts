import type { ChatMessage, LlmProvider } from "../../providers/types.js";
import type { ToolExecutionContext, ToolLike } from "../tools/types.js";
import type { AgentBackend, AgentBackendId, AgentEvent, AgentEventSource, AgentRunOptions, AgentRunResult, BackendCapabilities } from "../agent.types.js";
import { agent_options_to_chat, llm_response_to_agent_result } from "./convert.js";
import { now_iso } from "../../utils/common.js";

/**
 * LlmProvider를 AgentBackend로 래핑.
 * tool_executors가 제공되면 multi-turn tool loop를 내부에서 실행.
 */
export class CliAgent implements AgentBackend {
  readonly native_tool_loop = true;
  readonly supports_resume = false;
  readonly capabilities: BackendCapabilities = {
    approval: false,
    structured_output: false,
    thinking: false,
    budget_tracking: false,
    tool_filtering: false,
    tool_result_events: true,
    send_input: false,
    tool_executors: true,
  };

  constructor(
    readonly id: AgentBackendId,
    private readonly provider: LlmProvider,
  ) {}

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const { messages, chat_options } = agent_options_to_chat(options);
    const emit = options.hooks?.on_event;
    const source: AgentEventSource = { backend: this.id, task_id: options.task_id };

    const executors = _build_executor_map(options.tool_executors);
    const tool_ctx: ToolExecutionContext = {
      task_id: options.task_id,
      signal: options.abort_signal,
      ...options.tool_context,
    };

    // on_stream → content_delta 래핑
    if (emit) {
      const original = chat_options.on_stream as ((c: string) => void | Promise<void>) | undefined;
      chat_options.on_stream = (chunk: string) => {
        _fire(emit, { type: "content_delta", source, at: now_iso(), text: chunk });
        if (original) void Promise.resolve(original(chunk)).catch(() => {});
      };
    }

    _fire(emit, { type: "init", source, at: now_iso() });

    const conversation: ChatMessage[] = [...messages];
    const max_turns = executors.size > 0 ? (options.max_turns ?? 8) : 1;
    let total_tool_calls = 0;
    const usage = { input: 0, output: 0, cache_read: 0, cache_creation: 0, cost: 0 };

    try {
      let last_response = await this.provider.chat({ messages: conversation, ...chat_options });
      _accum_usage(usage, last_response.usage);

      for (let turn = 1; turn < max_turns; turn++) {
        if (options.abort_signal?.aborted) break;
        if (!last_response.has_tool_calls || executors.size === 0) break;

        const tool_calls = last_response.tool_calls;
        total_tool_calls += tool_calls.length;

        // assistant 메시지 + tool_calls (OpenAI format)
        conversation.push({
          role: "assistant",
          content: last_response.content || "",
          tool_calls: tool_calls.map(tc => ({
            id: tc.id, type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        });

        for (const tc of tool_calls) {
          _fire(emit, {
            type: "tool_use", source, at: now_iso(),
            tool_name: tc.name, tool_id: tc.id, params: tc.arguments,
          });

          const result = await _execute_single_tool(
            tc.name, tc.arguments || {}, executors, tool_ctx, options.hooks,
          );

          conversation.push({ role: "tool", tool_call_id: tc.id, content: result.text });
          _fire(emit, {
            type: "tool_result", source, at: now_iso(),
            tool_name: tc.name, tool_id: tc.id,
            result: result.text, is_error: result.is_error,
          });
        }

        last_response = await this.provider.chat({ messages: conversation, ...chat_options });
        _accum_usage(usage, last_response.usage);
      }

      // 최종 응답에 tool_calls가 남아있으면 카운트
      if (last_response.has_tool_calls) {
        total_tool_calls += last_response.tool_calls.length;
        for (const tc of last_response.tool_calls) {
          _fire(emit, {
            type: "tool_use", source, at: now_iso(),
            tool_name: tc.name, tool_id: tc.id, params: tc.arguments,
          });
        }
      }

      _emit_usage(emit, source, usage);

      const finish = _map_finish_reason(last_response.finish_reason);
      _fire(emit, {
        type: "complete", source, at: now_iso(),
        finish_reason: finish, content: last_response.content ?? undefined,
      });

      const base = llm_response_to_agent_result(last_response, this.id);
      return {
        ...base,
        tool_calls_count: total_tool_calls + base.tool_calls_count,
        usage: {
          prompt_tokens: usage.input,
          completion_tokens: usage.output,
          cache_read_input_tokens: usage.cache_read || undefined,
          cache_creation_input_tokens: usage.cache_creation || undefined,
          total_cost_usd: usage.cost || undefined,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      _fire(emit, { type: "error", source, at: now_iso(), error: msg });
      return {
        content: `Error: ${msg}`,
        session: null,
        tool_calls_count: total_tool_calls,
        usage: {},
        finish_reason: "error",
        metadata: { error: msg },
      };
    }
  }

  is_available(): boolean {
    return true;
  }
}

// ── helpers ──

function _build_executor_map(tool_executors?: ToolLike[]): Map<string, ToolLike> {
  const map = new Map<string, ToolLike>();
  for (const t of tool_executors ?? []) map.set(t.name, t);
  return map;
}

function _accum_usage(
  acc: { input: number; output: number; cache_read: number; cache_creation: number; cost: number },
  u: import("../../providers/types.js").LlmUsage,
): void {
  acc.input += u.prompt_tokens || 0;
  acc.output += u.completion_tokens || 0;
  acc.cache_read += u.cache_read_input_tokens || 0;
  acc.cache_creation += u.cache_creation_input_tokens || 0;
  acc.cost += u.total_cost_usd || 0;
}

function _emit_usage(
  emit: ((e: AgentEvent) => void | Promise<void>) | undefined,
  source: AgentEventSource,
  usage: { input: number; output: number; cache_read: number; cache_creation: number; cost: number },
): void {
  if (!usage.input && !usage.output) return;
  _fire(emit, {
    type: "usage", source, at: now_iso(),
    tokens: {
      input: usage.input, output: usage.output,
      cache_read: usage.cache_read || undefined,
      cache_creation: usage.cache_creation || undefined,
    },
    cost_usd: usage.cost || undefined,
  });
}

type ToolResult = { text: string; is_error: boolean };

async function _execute_single_tool(
  name: string,
  params: Record<string, unknown>,
  executors: Map<string, ToolLike>,
  ctx: ToolExecutionContext,
  hooks?: import("../agent.types.js").AgentHooks,
): Promise<ToolResult> {
  // pre_tool_use hook
  if (hooks?.pre_tool_use) {
    const pre = await hooks.pre_tool_use(name, params, ctx);
    if (pre?.permission === "deny") {
      return { text: `Error: ${pre.reason || "tool_blocked_by_policy"}`, is_error: true };
    }
    if (pre?.updated_params) Object.assign(params, pre.updated_params);
  }

  const executor = executors.get(name);
  let text: string;
  let is_error = false;

  if (executor) {
    try {
      text = await executor.execute(params, ctx);
    } catch (e) {
      text = `Error: ${e instanceof Error ? e.message : String(e)}`;
      is_error = true;
    }
  } else {
    text = `Error: tool_not_found:${name}`;
    is_error = true;
  }

  // post_tool_use hook
  if (hooks?.post_tool_use) {
    void Promise.resolve(hooks.post_tool_use(name, params, text, ctx, is_error)).catch(() => {});
  }

  return { text, is_error };
}

function _map_finish_reason(raw: string): import("../agent.types.js").AgentFinishReason {
  if (raw === "error") return "error";
  if (raw === "length" || raw === "max_tokens") return "max_tokens";
  return "stop";
}

function _fire(
  emit: ((event: AgentEvent) => void | Promise<void>) | undefined,
  event: AgentEvent,
): void {
  if (!emit) return;
  void Promise.resolve(emit(event)).catch(() => {});
}
