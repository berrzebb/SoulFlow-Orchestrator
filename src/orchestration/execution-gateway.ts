/**
 * GW-3: ExecutionGateway — provider/executor 결정 + fallback chain.
 *
 * provider 결정 책임을 gateway로 집중.
 * orchestration이 provider decision 세부를 직접 소유하지 않음.
 * provider invocation 자체는 dispatcher가 담당 (경계 유지).
 */

import type { RequestPlan } from "./gateway-contracts.js";
import type { ExecutorProvider, ProviderCapabilities } from "../providers/executor.js";
import { resolve_executor_provider } from "../providers/executor.js";

/** gateway가 결정한 실행 경로. primary executor + 대체 fallback 목록. */
export type ExecutionRoute = {
  primary: ExecutorProvider;
  fallbacks: ExecutorProvider[];
};

/** provider/executor 결정을 소유하는 gateway 계약. */
export type ExecutionGatewayLike = {
  resolve(plan: RequestPlan, caps: ProviderCapabilities, preference: ExecutorProvider): ExecutionRoute;
};

/** capability 확인 매핑. orchestrator_llm은 항상 사용 가능하므로 제외. */
const CAPABILITY_CHECK: Partial<Record<string, keyof ProviderCapabilities>> = {
  chatgpt: "chatgpt_available",
  claude_code: "claude_available",
  openrouter: "openrouter_available",
};

/** caps에서 해당 executor가 사용 가능한지 판별. */
function is_available(executor: ExecutorProvider, caps: ProviderCapabilities): boolean {
  const key = CAPABILITY_CHECK[executor];
  if (!key) return true; // orchestrator_llm, gemini 등 → 항상 사용 가능
  return !!caps[key];
}

/** primary를 제외하고 사용 가능한 executor를 fallback 우선순위로 반환. */
export function build_fallback_chain(
  primary: ExecutorProvider,
  caps: ProviderCapabilities,
): ExecutorProvider[] {
  const order: ExecutorProvider[] = ["chatgpt", "claude_code", "openrouter", "orchestrator_llm"];
  const chain: ExecutorProvider[] = [];
  for (const candidate of order) {
    if (candidate === primary) continue;
    if (is_available(candidate, caps)) chain.push(candidate);
  }
  return chain;
}

/** ExecutionGateway 팩토리. */
export function create_execution_gateway(): ExecutionGatewayLike {
  return {
    resolve(plan, caps, preference) {
      // no_token (identity/builtin/inquiry/direct_tool) → LLM executor 불필요.
      // preference를 primary로 두지만 fallback 없음 — 외부 provider 호출 안 함.
      if (plan.route === "no_token") {
        return { primary: preference, fallbacks: [] };
      }

      // model_direct/agent_required → plan에 executor가 있으면 사용, 없으면 preference 해결.
      const primary = "executor" in plan
        ? plan.executor
        : resolve_executor_provider(preference, caps);
      const fallbacks = build_fallback_chain(primary, caps);
      return { primary, fallbacks };
    },
  };
}
