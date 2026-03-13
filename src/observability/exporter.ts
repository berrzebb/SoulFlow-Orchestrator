/**
 * OB-8: Optional Exporter Ports.
 *
 * TraceExporter / MetricsExporter 인터페이스와 no-op 어댑터.
 * 외부 백엔드(OTLP, file, HTTP 등)로 데이터를 내보내는 포트를 정의하되,
 * 기본값은 no-op — local mode에서 성능 영향 없이 동작한다.
 */
import type { ExecutionSpan } from "./span.js";
import type { MetricsSnapshot } from "./metrics.js";

/** trace exporter 최소 계약. */
export interface TraceExporterLike {
  /** 완료된 span 배치를 외부로 내보냄. */
  export(spans: ReadonlyArray<ExecutionSpan>): Promise<void>;
  /** 리소스 해제. */
  shutdown(): Promise<void>;
}

/** metrics exporter 최소 계약. */
export interface MetricsExporterLike {
  /** 현재 metrics 스냅샷을 외부로 내보냄. */
  export(snapshot: MetricsSnapshot): Promise<void>;
  /** 리소스 해제. */
  shutdown(): Promise<void>;
}

/** 아무것도 하지 않는 trace exporter. local mode 기본값. */
export const NOOP_TRACE_EXPORTER: TraceExporterLike = {
  export: async () => {},
  shutdown: async () => {},
};

/** 아무것도 하지 않는 metrics exporter. local mode 기본값. */
export const NOOP_METRICS_EXPORTER: MetricsExporterLike = {
  export: async () => {},
  shutdown: async () => {},
};

/**
 * span 완료 시 exporter에 전달하는 어댑터.
 *
 * ExecutionSpanRecorder의 on_end 콜백으로 사용.
 * 내부 버퍼에 span을 모으고 flush()로 일괄 export한다.
 */
export class SpanExportAdapter {
  private _buffer: ExecutionSpan[] = [];
  private readonly _exporter: TraceExporterLike;
  private readonly _max_buffer: number;

  constructor(exporter: TraceExporterLike, options?: { max_buffer?: number }) {
    this._exporter = exporter;
    this._max_buffer = options?.max_buffer ?? 100;
  }

  /** on_end 콜백으로 등록할 함수. */
  on_span_end = (span: ExecutionSpan): void => {
    this._buffer.push(span);
    if (this._buffer.length >= this._max_buffer) {
      void this.flush();
    }
  };

  /** 버퍼의 span을 exporter로 일괄 전송. */
  async flush(): Promise<void> {
    if (this._buffer.length === 0) return;
    const batch = this._buffer.splice(0);
    await this._exporter.export(batch);
  }

  /** shutdown: 잔여 버퍼 flush + exporter shutdown. */
  async shutdown(): Promise<void> {
    await this.flush();
    await this._exporter.shutdown();
  }

  get buffered_count(): number {
    return this._buffer.length;
  }
}

/**
 * metrics를 주기적으로 exporter에 전달하는 어댑터.
 *
 * start()로 interval 시작, stop()으로 종료.
 */
export class MetricsExportAdapter {
  private _timer: ReturnType<typeof setInterval> | null = null;
  private readonly _exporter: MetricsExporterLike;
  private readonly _get_snapshot: () => MetricsSnapshot;
  private readonly _interval_ms: number;

  constructor(
    exporter: MetricsExporterLike,
    get_snapshot: () => MetricsSnapshot,
    options?: { interval_ms?: number },
  ) {
    this._exporter = exporter;
    this._get_snapshot = get_snapshot;
    this._interval_ms = options?.interval_ms ?? 60_000;
  }

  start(): void {
    if (this._timer) return;
    this._timer = setInterval(() => {
      void this._exporter.export(this._get_snapshot());
    }, this._interval_ms);
    this._timer.unref();
  }

  async stop(): Promise<void> {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    await this._exporter.export(this._get_snapshot());
    await this._exporter.shutdown();
  }

  get running(): boolean {
    return this._timer !== null;
  }
}
