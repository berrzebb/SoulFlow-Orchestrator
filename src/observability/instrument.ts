/**
 * OB-5: 실행 경계 계측 헬퍼.
 *
 * span start/end + metrics counter/histogram을 감싸는 재사용 래퍼.
 * 각 서비스가 직접 span/metrics 코드를 반복하지 않도록 한다.
 */
import type { ObservabilityLike } from "./context.js";
import type { SpanKind, SpanHandle } from "./span.js";
import type { CorrelationContext } from "./correlation.js";
import type { Labels } from "./metrics.js";

export type InstrumentOptions = {
  kind: SpanKind;
  name: string;
  correlation: Partial<CorrelationContext>;
  attributes?: Record<string, unknown>;
  /** counter 이름. 완료 시 +1. */
  counter?: string;
  /** counter 라벨. */
  counter_labels?: Labels;
  /** histogram 이름. duration_ms 기록. */
  histogram?: string;
  /** histogram 라벨. */
  histogram_labels?: Labels;
};

export type InstrumentResult<T> = {
  value: T;
  span: ReturnType<SpanHandle["end"]>;
  duration_ms: number;
};

/**
 * 비동기 함수를 span + metrics로 감싸서 실행.
 *
 * 성공 시 span.end("ok"), 실패 시 span.fail(error).
 * counter/histogram 이름이 지정되면 자동 기록.
 */
export async function instrument<T>(
  obs: ObservabilityLike,
  opts: InstrumentOptions,
  fn: (handle: SpanHandle) => Promise<T>,
): Promise<T> {
  const start = Date.now();
  const handle = obs.spans.start(opts.kind, opts.name, opts.correlation, opts.attributes);

  try {
    const value = await fn(handle);
    handle.end("ok");

    const duration = Date.now() - start;
    if (opts.counter) obs.metrics.counter(opts.counter, 1, opts.counter_labels);
    if (opts.histogram) obs.metrics.histogram(opts.histogram, duration, opts.histogram_labels);

    return value;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    handle.fail(message);

    const duration = Date.now() - start;
    if (opts.counter) obs.metrics.counter(opts.counter, 1, { ...opts.counter_labels, status: "error" });
    if (opts.histogram) obs.metrics.histogram(opts.histogram, duration, opts.histogram_labels);

    throw err;
  }
}

/**
 * 동기 함수를 span + metrics로 감싸서 실행.
 */
export function instrument_sync<T>(
  obs: ObservabilityLike,
  opts: InstrumentOptions,
  fn: (handle: SpanHandle) => T,
): T {
  const start = Date.now();
  const handle = obs.spans.start(opts.kind, opts.name, opts.correlation, opts.attributes);

  try {
    const value = fn(handle);
    handle.end("ok");

    const duration = Date.now() - start;
    if (opts.counter) obs.metrics.counter(opts.counter, 1, opts.counter_labels);
    if (opts.histogram) obs.metrics.histogram(opts.histogram, duration, opts.histogram_labels);

    return value;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    handle.fail(message);

    const duration = Date.now() - start;
    if (opts.counter) obs.metrics.counter(opts.counter, 1, { ...opts.counter_labels, status: "error" });
    if (opts.histogram) obs.metrics.histogram(opts.histogram, duration, opts.histogram_labels);

    throw err;
  }
}
