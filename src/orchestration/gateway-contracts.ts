/**
 * GW-1: RequestPlan / ResultEnvelope — 실행 경로와 결과 표현의 공통 계약.
 *
 * GatewayDecision → RequestPlan 매핑으로 기존 코드와 호환 유지.
 * ResultEnvelope는 delivery 관심사만 포함 (storage 분리).
 */

import type { ChannelProvider } from "../channels/types.js";
import type { ExecutionMode, OrchestrationResult, ResultUsage } from "./types.js";
import type { ExecutorProvider } from "../providers/executor.js";
import type { GatewayDecision } from "./gateway.js";

/** 비용 기반 실행 경로 분류. no_token이 가장 저렴, agent_required가 가장 비쌈. */
export type CostTier = "no_token" | "model_direct" | "agent_required";

/** 응답을 전달할 채널 참조. */
export type ReplyChannelRef = {
  provider: ChannelProvider;
  chat_id: string;
  thread_id?: string;
};

/** LLM 없이 수행 가능한 직접 실행 계획. */
export type DirectToolPlan = {
  tool_name: string;
  args?: Record<string, unknown>;
};

/** 통합 실행 계획. direct/model/workflow/agent 모두 같은 타입 사용. */
export type RequestPlan =
  | { route: "no_token"; kind: "identity" }
  | { route: "no_token"; kind: "builtin"; command: string; args?: string }
  | { route: "no_token"; kind: "inquiry"; summary: string }
  | { route: "no_token"; kind: "direct_tool"; plan: DirectToolPlan }
  | { route: "model_direct"; kind: "once"; executor: ExecutorProvider; tool_categories?: string[] }
  | { route: "agent_required"; kind: "agent"; executor: ExecutorProvider; tool_categories?: string[] }
  | { route: "agent_required"; kind: "task"; executor: ExecutorProvider; tool_categories?: string[] }
  | { route: "agent_required"; kind: "workflow"; executor: ExecutorProvider; workflow_id?: string; node_categories?: string[] };

/** 실행 결과 봉투. delivery 관심사만 포함. */
export type ResultEnvelope = {
  reply_to: ReplyChannelRef;
  content: string | null;
  cost_tier: CostTier;
  mode: ExecutionMode;
  error?: string;
  usage?: ResultUsage;
  tools_used?: string[];
  streamed: boolean;
  suppress_reply?: boolean;
};

/** GatewayDecision → RequestPlan 변환. */
export function to_request_plan(decision: GatewayDecision): RequestPlan {
  if (decision.action === "identity") {
    return { route: "no_token", kind: "identity" };
  }
  if (decision.action === "builtin") {
    return { route: "no_token", kind: "builtin", command: decision.command, args: decision.args };
  }
  if (decision.action === "inquiry") {
    return { route: "no_token", kind: "inquiry", summary: decision.summary };
  }
  if (decision.action === "direct_tool") {
    return { route: "no_token", kind: "direct_tool", plan: { tool_name: decision.tool_name, args: decision.args } };
  }
  const { mode, executor, tool_categories, workflow_id, node_categories } = decision;
  if (mode === "once") {
    return { route: "model_direct", kind: "once", executor, tool_categories };
  }
  if (mode === "phase") {
    return { route: "agent_required", kind: "workflow", executor, workflow_id, node_categories };
  }
  if (mode === "task") {
    return { route: "agent_required", kind: "task", executor, tool_categories };
  }
  return { route: "agent_required", kind: "agent", executor, tool_categories };
}

/** RequestPlan → CostTier 추출. */
export function plan_cost_tier(plan: RequestPlan): CostTier {
  return plan.route;
}

/** ReplyChannelRef 생성. */
export function build_reply_ref(
  provider: ChannelProvider,
  chat_id: string,
  thread_id?: string,
): ReplyChannelRef {
  return { provider, chat_id, ...(thread_id ? { thread_id } : {}) };
}

/** OrchestrationResult + ReplyChannelRef → ResultEnvelope 변환. */
export function to_result_envelope(
  result: OrchestrationResult,
  reply_to: ReplyChannelRef,
): ResultEnvelope {
  const cost_tier = result_cost_tier(result.mode);
  return {
    reply_to,
    content: result.reply,
    cost_tier,
    mode: result.mode,
    error: result.error,
    usage: result.usage,
    tools_used: result.tools_used,
    streamed: result.streamed,
    suppress_reply: result.suppress_reply,
  };
}

/** ExecutionMode → CostTier 매핑. */
export function result_cost_tier(mode: ExecutionMode): CostTier {
  if (mode === "once") return "model_direct";
  return "agent_required";
}

/** delivery 경계 편의 함수: OrchestrationResult + 채널 정보 → ResultEnvelope. */
export function build_delivery_envelope(
  result: OrchestrationResult,
  provider: ChannelProvider,
  chat_id: string,
  thread_id?: string,
): ResultEnvelope {
  return to_result_envelope(result, build_reply_ref(provider, chat_id, thread_id));
}
