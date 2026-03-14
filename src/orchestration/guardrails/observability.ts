/**
 * EG-5: Guardrail Observability.
 *
 * guardrail decision을 metrics counters로 방출.
 * stop_reason 필드를 파싱하여 session_reuse / budget_exceeded를 구분.
 */

import type { MetricsSinkLike } from "../../observability/metrics.js";
import type { OrchestrationResult } from "../types.js";
import { STOP_REASON_BUDGET_EXCEEDED } from "./budget-policy.js";

/** stop_reason 기반 guardrail 메트릭 방출. */
export function record_guardrail_metrics(
  metrics: MetricsSinkLike,
  result: OrchestrationResult,
  provider: string,
): void {
  const sr = result.stop_reason;
  if (!sr) return;
  if (sr.startsWith("session_reuse:")) {
    metrics.counter("guardrail_session_reuse_total", 1, { kind: sr.replace("session_reuse:", ""), provider });
  } else if (sr === STOP_REASON_BUDGET_EXCEEDED) {
    metrics.counter("guardrail_budget_exceeded_total", 1, { provider, mode: result.mode });
  }
}
