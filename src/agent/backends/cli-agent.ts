import type { ChatMessage, LlmProvider } from "../../providers/types.js";
import type { ToolExecutionContext } from "../tools/types.js";
import type { AgentBackend, AgentBackendId, AgentEventSource, AgentRunOptions, AgentRunResult, BackendCapabilities } from "../agent.types.js";
import { agent_options_to_chat, llm_response_to_agent_result } from "./convert.js";
import { now_iso } from "../../utils/common.js";
import { build_executor_map, execute_single_tool, map_finish_reason, fire, accum_usage, emit_usage } from "./tool-loop-helpers.js";

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

    const executors = build_executor_map(options.tool_executors);
    const tool_ctx: ToolExecutionContext = {
      task_id: options.task_id,
      signal: options.abort_signal,
      ...options.tool_context,
    };

    // on_stream → content_delta 래핑
    if (emit) {
      const original = chat_options.on_stream as ((c: string) => void | Promise<void>) | undefined;
      chat_options.on_stream = (chunk: string) => {
        fire(emit, { type: "content_delta", source, at: now_iso(), text: chunk });
        if (original) void Promise.resolve(original(chunk)).catch(() => {});
      };
    }

    fire(emit, { type: "init", source, at: now_iso() });

    const conversation: ChatMessage[] = [...messages];
    const max_turns = executors.size > 0 ? (options.max_turns ?? 8) : 1;
    let total_tool_calls = 0;
    const usage = { input: 0, output: 0, cache_read: 0, cache_creation: 0, cost: 0 };

    try {
      let last_response = await this.provider.chat({ messages: conversation, ...chat_options });
      accum_usage(usage, last_response.usage);

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
          fire(emit, {
            type: "tool_use", source, at: now_iso(),
            tool_name: tc.name, tool_id: tc.id, params: tc.arguments,
          });

          const result = await execute_single_tool(
            tc.name, tc.arguments || {}, executors, tool_ctx, options.hooks,
          );

          conversation.push({ role: "tool", tool_call_id: tc.id, content: result.text });
          fire(emit, {
            type: "tool_result", source, at: now_iso(),
            tool_name: tc.name, tool_id: tc.id,
            result: result.text, is_error: result.is_error,
          });
        }

        last_response = await this.provider.chat({ messages: conversation, ...chat_options });
        accum_usage(usage, last_response.usage);
      }

      // 최종 응답에 tool_calls가 남아있으면 카운트
      if (last_response.has_tool_calls) {
        total_tool_calls += last_response.tool_calls.length;
        for (const tc of last_response.tool_calls) {
          fire(emit, {
            type: "tool_use", source, at: now_iso(),
            tool_name: tc.name, tool_id: tc.id, params: tc.arguments,
          });
        }
      }

      emit_usage(emit, source, usage);

      const finish = map_finish_reason(last_response.finish_reason);
      fire(emit, {
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
      fire(emit, { type: "error", source, at: now_iso(), error: msg });
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
