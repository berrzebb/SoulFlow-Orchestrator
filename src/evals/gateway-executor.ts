/**
 * GW-2/3/4: Gateway Eval Executor.
 *
 * classifier + cost_tier + route + direct 분류를 EvalExecutorLike로 감싸
 * eval pipeline에서 라우팅 회귀 테스트를 실행할 수 있게 한다.
 *
 * input JSON schema:
 *   classify   → { type, text, active_tasks? }       — 실행 모드 분류
 *   cost_tier  → { type, text, active_tasks? }       — 비용 기반 분류
 *   normalize  → { type, text, provider }             — ingress 정규화
 *   route      → { type, plan_kind, executor?, caps } — ExecutionGateway 경로 결정
 *   direct     → { type, tool_name }                  — DirectExecutor 허용 판별
 */

import type { EvalExecutorLike } from "./contracts.js";
import { fast_classify } from "../orchestration/classifier.js";
import { classify_cost_tier } from "../orchestration/classifier.js";
import { normalize_ingress } from "../orchestration/ingress-normalizer.js";
import { create_execution_gateway } from "../orchestration/execution-gateway.js";
import { create_direct_executor } from "../orchestration/execution/direct-executor.js";
import type { RequestPlan } from "../orchestration/gateway-contracts.js";
import type { ProviderCapabilities, ExecutorProvider } from "../providers/executor.js";
import type { InboundMessage } from "../bus/types.js";

/** executor가 파싱하는 입력 구조. */
export type GatewayEvalInput =
  | { type: "classify"; text: string; active_tasks?: number }
  | { type: "cost_tier"; text: string; active_tasks?: number }
  | { type: "normalize"; text: string; provider: string }
  | { type: "route"; plan_kind: string; executor?: string; preference?: string; caps?: Partial<ProviderCapabilities> }
  | { type: "direct"; tool_name: string };

/** eval용 RequestPlan 생성 헬퍼. */
function build_eval_plan(kind: string, executor?: ExecutorProvider): RequestPlan {
  const exec = executor ?? "chatgpt";
  switch (kind) {
    case "identity": return { route: "no_token", kind: "identity" };
    case "builtin": return { route: "no_token", kind: "builtin", command: "help" };
    case "direct_tool": return { route: "no_token", kind: "direct_tool", plan: { tool_name: "datetime" } };
    case "once": return { route: "model_direct", kind: "once", executor: exec };
    case "agent": return { route: "agent_required", kind: "agent", executor: exec };
    case "task": return { route: "agent_required", kind: "task", executor: exec };
    case "workflow": return { route: "agent_required", kind: "workflow", executor: exec };
    default: return { route: "model_direct", kind: "once", executor: exec };
  }
}

/** gateway 분류/정규화를 eval pipeline에 연결하는 executor 생성. */
export function create_gateway_executor(): EvalExecutorLike {
  return {
    async execute(raw_input: string) {
      try {
        const input: GatewayEvalInput = JSON.parse(raw_input);

        if (input.type === "classify") {
          const tasks = input.active_tasks
            ? Array.from({ length: input.active_tasks }, (_, i) => ({ id: `t${i}`, status: "running" as const }))
            : undefined;
          const result = fast_classify(input.text, { active_tasks: tasks as never });
          return { output: result.mode };
        }

        if (input.type === "cost_tier") {
          const tasks = input.active_tasks
            ? Array.from({ length: input.active_tasks }, (_, i) => ({ id: `t${i}`, status: "running" as const }))
            : undefined;
          const result = fast_classify(input.text, { active_tasks: tasks as never });
          return { output: classify_cost_tier(result) };
        }

        if (input.type === "normalize") {
          const message: InboundMessage = {
            id: "eval-msg",
            provider: input.provider,
            channel: input.provider,
            sender_id: "eval-user",
            chat_id: "eval-chat",
            content: input.text,
            at: new Date().toISOString(),
          };
          const normalized = normalize_ingress(message, input.provider);
          return { output: normalized.text };
        }

        if (input.type === "route") {
          const gw = create_execution_gateway();
          const caps: ProviderCapabilities = {
            chatgpt_available: input.caps?.chatgpt_available ?? true,
            claude_available: input.caps?.claude_available ?? true,
            openrouter_available: input.caps?.openrouter_available ?? false,
          };
          const pref = (input.preference ?? "chatgpt") as ExecutorProvider;
          const plan = build_eval_plan(input.plan_kind, input.executor as ExecutorProvider | undefined);
          const route = gw.resolve(plan, caps, pref);
          return { output: `${route.primary}:${route.fallbacks.length}` };
        }

        if (input.type === "direct") {
          const de = create_direct_executor();
          return { output: de.is_allowed(input.tool_name) ? "allowed" : "denied" };
        }

        return { output: "", error: `unknown gateway eval type: ${(input as Record<string, unknown>).type}` };
      } catch (e) {
        return { output: "", error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
