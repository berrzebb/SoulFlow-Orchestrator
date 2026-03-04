/** tool loop 공유 헬퍼. CliAgent, OpenAiCompatibleAgent 등이 공용으로 사용. */

import type { ToolExecutionContext, ToolLike } from "../tools/types.js";
import type { AgentEvent, AgentEventSource, AgentFinishReason, AgentHooks } from "../agent.types.js";
import type { LlmUsage } from "../../providers/types.js";
import { now_iso, error_message} from "../../utils/common.js";

export type UsageAccumulator = {
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
  cost: number;
};

export type ToolResult = { text: string; is_error: boolean };

export function build_executor_map(tool_executors?: ToolLike[]): Map<string, ToolLike> {
  const map = new Map<string, ToolLike>();
  for (const t of tool_executors ?? []) map.set(t.name, t);
  return map;
}

export async function execute_single_tool(
  name: string,
  params: Record<string, unknown>,
  executors: Map<string, ToolLike>,
  ctx: ToolExecutionContext,
  hooks?: AgentHooks,
): Promise<ToolResult> {
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
      text = `Error: ${error_message(e)}`;
      is_error = true;
    }
  } else {
    text = `Error: tool_not_found:${name}`;
    is_error = true;
  }

  if (hooks?.post_tool_use) {
    void Promise.resolve(hooks.post_tool_use(name, params, text, ctx, is_error)).catch(() => {});
  }

  return { text, is_error };
}

export function map_finish_reason(raw: string): AgentFinishReason {
  if (raw === "error") return "error";
  if (raw === "length" || raw === "max_tokens") return "max_tokens";
  return "stop";
}

export function fire(
  emit: ((event: AgentEvent) => void | Promise<void>) | undefined,
  event: AgentEvent,
): void {
  if (!emit) return;
  void Promise.resolve(emit(event)).catch(() => {});
}

export function accum_usage(acc: UsageAccumulator, u: LlmUsage): void {
  acc.input += u.prompt_tokens || 0;
  acc.output += u.completion_tokens || 0;
  acc.cache_read += u.cache_read_input_tokens || 0;
  acc.cache_creation += u.cache_creation_input_tokens || 0;
  acc.cost += u.total_cost_usd || 0;
}

export function emit_usage(
  emit: ((e: AgentEvent) => void | Promise<void>) | undefined,
  source: AgentEventSource,
  usage: UsageAccumulator,
): void {
  if (!usage.input && !usage.output) return;
  fire(emit, {
    type: "usage", source, at: now_iso(),
    tokens: {
      input: usage.input, output: usage.output,
      cache_read: usage.cache_read || undefined,
      cache_creation: usage.cache_creation || undefined,
    },
    cost_usd: usage.cost || undefined,
  });
}
