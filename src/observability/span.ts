/**
 * OB-3: Trace / Span Recorder.
 *
 * direct/model/workflow/agent 경로를 같은 trace 모델로 기록한다.
 * OTEL 없이 in-process span recording + JSON envelope 기반 로그 출력.
 */
import { randomUUID } from "node:crypto";
import { now_iso } from "../utils/common.js";
import type { CorrelationContext } from "./correlation.js";

/** span이 나타내는 실행 경로 종류. */
export type SpanKind =
  | "http_request"
  | "dashboard_route"
  | "channel_inbound"
  | "orchestration_run"
  | "workflow_run"
  | "delivery";

/** span 종료 상태. */
export type SpanStatus = "ok" | "error" | "timeout";

/** 단일 실행 구간을 기록하는 불변 데이터. */
export interface ExecutionSpan {
  span_id: string;
  trace_id: string;
  parent_span_id?: string;
  kind: SpanKind;
  name: string;
  started_at: string;
  ended_at?: string;
  duration_ms?: number;
  status?: SpanStatus;
  error?: string;
  attributes: Record<string, unknown>;
  correlation: Partial<CorrelationContext>;
}

/** span을 열고 닫는 핸들. start()가 반환한다. */
export interface SpanHandle {
  readonly span: ExecutionSpan;
  /** span 정상 종료. */
  end(status?: SpanStatus, attributes?: Record<string, unknown>): ExecutionSpan;
  /** span 에러 종료. */
  fail(error: string, attributes?: Record<string, unknown>): ExecutionSpan;
}

/** span 기록기 최소 계약. no-op 구현 가능. */
export interface SpanRecorderLike {
  start(
    kind: SpanKind,
    name: string,
    correlation: Partial<CorrelationContext>,
    attributes?: Record<string, unknown>,
  ): SpanHandle;
  get_spans(): ReadonlyArray<ExecutionSpan>;
}

/** span 종료 시 호출되는 콜백. 로그 출력 등에 사용. */
export type OnSpanEnd = (span: ExecutionSpan) => void;

/** in-process span recorder. 순환 버퍼로 최근 span만 유지. */
export class ExecutionSpanRecorder implements SpanRecorderLike {
  private readonly _spans: ExecutionSpan[] = [];
  private readonly _max: number;
  private readonly _on_end?: OnSpanEnd;

  constructor(options?: { max_spans?: number; on_end?: OnSpanEnd }) {
    this._max = options?.max_spans ?? 1000;
    this._on_end = options?.on_end;
  }

  start(
    kind: SpanKind,
    name: string,
    correlation: Partial<CorrelationContext>,
    attributes: Record<string, unknown> = {},
  ): SpanHandle {
    const start_time = Date.now();
    const span: ExecutionSpan = {
      span_id: randomUUID(),
      trace_id: correlation.trace_id ?? randomUUID(),
      kind,
      name,
      started_at: now_iso(),
      attributes: { ...attributes },
      correlation: { ...correlation },
    };

    let ended = false;

    const finish = (status: SpanStatus, extra_attrs?: Record<string, unknown>, error?: string): ExecutionSpan => {
      if (ended) return span;
      ended = true;
      span.ended_at = now_iso();
      span.duration_ms = Date.now() - start_time;
      span.status = status;
      if (error) span.error = error;
      if (extra_attrs) Object.assign(span.attributes, extra_attrs);
      this._push(span);
      this._on_end?.(span);
      return span;
    };

    return {
      span,
      end: (status = "ok", attrs?) => finish(status, attrs),
      fail: (err, attrs?) => finish("error", attrs, err),
    };
  }

  get_spans(): ReadonlyArray<ExecutionSpan> {
    return this._spans;
  }

  /** 종료된 span 수. */
  get completed_count(): number {
    return this._spans.length;
  }

  clear(): void {
    this._spans.length = 0;
  }

  private _push(span: ExecutionSpan): void {
    this._spans.push(span);
    if (this._spans.length > this._max) {
      this._spans.shift();
    }
  }
}
