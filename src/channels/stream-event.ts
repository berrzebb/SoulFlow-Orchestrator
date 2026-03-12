/**
 * 프로바이더 무관 통합 스트리밍 이벤트.
 * 에이전트 백엔드 출력(ndjson) → StreamEvent → 채널별 Renderer → 전송.
 */

import type { AgentEvent } from "../agent/agent.types.js";

export type StreamEvent =
  | { type: "delta";       content: string }
  | { type: "thinking";    tokens: number; preview: string }
  | { type: "tool_start";  name: string; id: string; params?: Record<string, unknown> }
  | { type: "tool_result"; name: string; id: string; result: string; is_error?: boolean }
  | { type: "usage";       input: number; output: number; cache_read?: number; cache_creation?: number; cost_usd?: number | null }
  | { type: "rate_limit";  status: "allowed_warning" | "rejected" }
  | { type: "compact";     pre_tokens: number }
  | { type: "done" };

/** AgentEvent → StreamEvent. 파이프라인 무관 이벤트는 null 반환. */
export function agent_event_to_stream(event: AgentEvent): StreamEvent | null {
  switch (event.type) {
    case "content_delta":
      return { type: "delta", content: event.text };
    case "thinking":
      return { type: "thinking", tokens: event.tokens ?? 0, preview: event.thinking_text.slice(0, 200) };
    case "tool_use":
      return { type: "tool_start", name: event.tool_name, id: event.tool_id, params: event.params };
    case "tool_result":
      return { type: "tool_result", name: event.tool_name, id: event.tool_id, result: event.result, is_error: event.is_error };
    case "usage":
      return { type: "usage", input: event.tokens.input, output: event.tokens.output, cache_read: event.tokens.cache_read, cache_creation: event.tokens.cache_creation, cost_usd: event.cost_usd };
    case "rate_limit":
      if (event.status === "allowed") return null;
      return { type: "rate_limit", status: event.status as "allowed_warning" | "rejected" };
    case "compact_boundary":
      return { type: "compact", pre_tokens: event.pre_tokens };
    default:
      return null;
  }
}
