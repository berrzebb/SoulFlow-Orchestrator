/**
 * PAR-5: Reconcile 경로 추적 이벤트 헬퍼.
 *
 * 기존 SpanRecorderLike에 reconcile 전용 이벤트 이름을 발행.
 * SpanKind "orchestration_run" + 이름으로 이벤트를 구분하여
 * 기존 span 계약을 변경하지 않고 reconcile 경로를 독립 식별.
 */

import type { SpanRecorderLike, ExecutionSpan, CorrelationContext } from "../observability/index.js";

// ── Types ────────────────────────────────────────────────────────

/** reconcile 파이프라인에서 발행되는 추적 이벤트 이름. */
export type ReconcileTraceEvent =
  | "reconcile_start"
  | "reconcile_conflict"
  | "reconcile_retry"
  | "reconcile_finalized";

/** 각 이벤트에 필요한 속성 타입 맵. */
export interface ReconcileTraceAttributes {
  reconcile_start: {
    source_node_ids: string[];
    policy: string;
  };
  reconcile_conflict: {
    conflict_count: number;
    conflict_fields: string[];
  };
  reconcile_retry: {
    round: number;
    rework_instruction?: string;
  };
  reconcile_finalized: {
    policy_applied: string;
    succeeded: number;
    failed: number;
    verdict?: string;
  };
}

// ── emit_reconcile_event ──────────────────────────────────────────

/**
 * reconcile 추적 이벤트를 span으로 발행.
 *
 * SpanKind "orchestration_run" + 이벤트 이름으로 기록.
 * 기존 SpanKind enum은 변경하지 않는다.
 */
export function emit_reconcile_event<E extends ReconcileTraceEvent>(
  recorder: SpanRecorderLike,
  event: E,
  correlation: Partial<CorrelationContext>,
  attributes: ReconcileTraceAttributes[E],
): ExecutionSpan {
  const handle = recorder.start(
    "orchestration_run",
    event,
    correlation,
    attributes as Record<string, unknown>,
  );
  return handle.end("ok");
}

// ── filter_reconcile_spans ────────────────────────────────────────

/**
 * recorder에서 reconcile 이벤트 span만 필터링.
 * 분석/대시보드용.
 */
export function filter_reconcile_spans(recorder: SpanRecorderLike): ExecutionSpan[] {
  const EVENTS: ReadonlySet<string> = new Set<ReconcileTraceEvent>([
    "reconcile_start",
    "reconcile_conflict",
    "reconcile_retry",
    "reconcile_finalized",
  ]);
  return recorder.get_spans().filter((s) => EVENTS.has(s.name));
}
