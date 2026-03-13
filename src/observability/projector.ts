/**
 * OB-7: Projector / Dashboard Read Model.
 *
 * raw spans + metrics를 운영자가 읽을 수 있는 요약으로 투영.
 * 대시보드 요청 시점에 계산 — 별도 스트림/저장소 없음.
 */
import type { ObservabilityLike } from "./context.js";
import type { SpanKind, ExecutionSpan } from "./span.js";

export type FailureGroup = {
  kind: SpanKind;
  count: number;
  recent_errors: Array<{ name: string; error: string; at: string }>;
};

export type ErrorRate = {
  total: number;
  errors: number;
  rate: number;
};

export type LatencyPercentiles = {
  kind: SpanKind;
  count: number;
  p50: number;
  p95: number;
  p99: number;
};

export type DeliveryMismatchEntry = {
  span_id: string;
  requested_channel: string;
  delivered_channel: string;
  delivery_status: string;
  at: string;
};

export type ProviderUsage = {
  provider: string;
  total: number;
  errors: number;
};

export type ObservabilitySummary = {
  failure_summary: FailureGroup[];
  error_rate: ErrorRate;
  latency_summary: LatencyPercentiles[];
  delivery_mismatch: DeliveryMismatchEntry[];
  provider_usage: ProviderUsage[];
};

/** 현재 spans + metrics에서 운영자 요약을 계산. */
export function project_summary(obs: ObservabilityLike): ObservabilitySummary {
  const spans = obs.spans.get_spans();
  const snap = obs.metrics.snapshot();

  return {
    failure_summary: compute_failure_summary(spans),
    error_rate: compute_error_rate(spans),
    latency_summary: compute_latency_summary(spans),
    delivery_mismatch: compute_delivery_mismatch(spans),
    provider_usage: compute_provider_usage(snap.counters),
  };
}

function compute_failure_summary(spans: ReadonlyArray<ExecutionSpan>): FailureGroup[] {
  const groups = new Map<SpanKind, { count: number; recent: Array<{ name: string; error: string; at: string }> }>();

  for (const s of spans) {
    if (s.status !== "error") continue;
    let g = groups.get(s.kind);
    if (!g) { g = { count: 0, recent: [] }; groups.set(s.kind, g); }
    g.count++;
    g.recent.push({ name: s.name, error: s.error || "unknown", at: s.ended_at || s.started_at });
  }

  return Array.from(groups.entries()).map(([kind, g]) => ({
    kind,
    count: g.count,
    recent_errors: g.recent.slice(-10),
  }));
}

function compute_error_rate(spans: ReadonlyArray<ExecutionSpan>): ErrorRate {
  const total = spans.length;
  if (total === 0) return { total: 0, errors: 0, rate: 0 };
  const errors = spans.filter(s => s.status === "error").length;
  return { total, errors, rate: errors / total };
}

function compute_latency_summary(spans: ReadonlyArray<ExecutionSpan>): LatencyPercentiles[] {
  const by_kind = new Map<SpanKind, number[]>();

  for (const s of spans) {
    if (s.duration_ms === undefined) continue;
    let arr = by_kind.get(s.kind);
    if (!arr) { arr = []; by_kind.set(s.kind, arr); }
    arr.push(s.duration_ms);
  }

  return Array.from(by_kind.entries()).map(([kind, durations]) => {
    durations.sort((a, b) => a - b);
    return {
      kind,
      count: durations.length,
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      p99: percentile(durations, 0.99),
    };
  });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function compute_delivery_mismatch(spans: ReadonlyArray<ExecutionSpan>): DeliveryMismatchEntry[] {
  const result: DeliveryMismatchEntry[] = [];

  for (const s of spans) {
    if (s.kind !== "delivery") continue;
    const requested = String(s.attributes.requested_channel || "");
    const delivered = String(s.attributes.delivered_channel || "");
    if (requested && delivered && requested !== delivered) {
      result.push({
        span_id: s.span_id,
        requested_channel: requested,
        delivered_channel: delivered,
        delivery_status: String(s.attributes.delivery_status || ""),
        at: s.ended_at || s.started_at,
      });
    }
  }

  return result;
}

function compute_provider_usage(
  counters: ReadonlyArray<{ name: string; labels: Record<string, string>; value: number }>,
): ProviderUsage[] {
  const by_provider = new Map<string, { total: number; errors: number }>();

  for (const c of counters) {
    if (c.name !== "orchestration_runs_total") continue;
    const provider = c.labels.provider;
    if (!provider) continue;
    let entry = by_provider.get(provider);
    if (!entry) { entry = { total: 0, errors: 0 }; by_provider.set(provider, entry); }
    entry.total += c.value;
    if (c.labels.status === "error") entry.errors += c.value;
  }

  return Array.from(by_provider.entries()).map(([provider, e]) => ({
    provider,
    total: e.total,
    errors: e.errors,
  }));
}
