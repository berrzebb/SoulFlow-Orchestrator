/**
 * GW-2: Gateway Eval Executor.
 *
 * classifier + cost_tier 분류를 EvalExecutorLike로 감싸
 * eval pipeline에서 라우팅 회귀 테스트를 실행할 수 있게 한다.
 *
 * input JSON schema:
 *   classify   → { type, text, active_tasks? }   — 실행 모드 분류
 *   cost_tier  → { type, text, active_tasks? }   — 비용 기반 분류
 *   normalize  → { type, text, provider }         — ingress 정규화
 */

import type { EvalExecutorLike } from "./contracts.js";
import { fast_classify } from "../orchestration/classifier.js";
import { classify_cost_tier } from "../orchestration/classifier.js";
import { normalize_ingress } from "../orchestration/ingress-normalizer.js";
import type { InboundMessage } from "../bus/types.js";

/** executor가 파싱하는 입력 구조. */
export type GatewayEvalInput =
  | { type: "classify"; text: string; active_tasks?: number }
  | { type: "cost_tier"; text: string; active_tasks?: number }
  | { type: "normalize"; text: string; provider: string };

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

        return { output: "", error: `unknown gateway eval type: ${(input as Record<string, unknown>).type}` };
      } catch (e) {
        return { output: "", error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
