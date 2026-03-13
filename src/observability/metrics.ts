/**
 * OB-4: In-process Metrics Sink.
 *
 * OTEL 없이 count/error/duration을 바로 조회할 수 있는 local metrics.
 * counter(누적), gauge(현재값), histogram(분포) 3가지 타입.
 */

/** counter/gauge/histogram 공통 라벨. */
export type Labels = Record<string, string>;

/** 라벨 포함 counter 한 줄. */
export type CounterEntry = { name: string; labels: Labels; value: number };

/** 라벨 포함 gauge 한 줄. */
export type GaugeEntry = { name: string; labels: Labels; value: number };

/** 라벨 포함 histogram 한 줄. */
export type HistogramEntry = {
  name: string;
  labels: Labels;
  count: number;
  sum: number;
  /** 각 bucket 상한값과 누적 카운트. */
  buckets: Array<{ le: number; count: number }>;
};

/** 전체 메트릭 스냅샷. */
export type MetricsSnapshot = {
  counters: CounterEntry[];
  gauges: GaugeEntry[];
  histograms: HistogramEntry[];
};

/** metrics sink 최소 계약. no-op 구현 가능. */
export interface MetricsSinkLike {
  counter(name: string, value?: number, labels?: Labels): void;
  gauge(name: string, value: number, labels?: Labels): void;
  histogram(name: string, value: number, labels?: Labels): void;
  snapshot(): MetricsSnapshot;
}

/** 라벨을 정렬된 JSON 문자열로 변환. compound key용. */
function label_key(name: string, labels: Labels): string {
  const sorted = Object.keys(labels).sort().map(k => `${k}=${labels[k]}`).join(",");
  return `${name}{${sorted}}`;
}

/** 기본 histogram bucket 상한값 (ms 기준 duration). */
const DEFAULT_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

type HistogramState = {
  name: string;
  labels: Labels;
  count: number;
  sum: number;
  bucket_counts: number[];
  bucket_bounds: number[];
};

/** in-process metrics sink. 메모리 기반, thread-safe 아님 (단일 이벤트루프 전제). */
export class MetricsSink implements MetricsSinkLike {
  private readonly _counters = new Map<string, { name: string; labels: Labels; value: number }>();
  private readonly _gauges = new Map<string, { name: string; labels: Labels; value: number }>();
  private readonly _histograms = new Map<string, HistogramState>();
  private readonly _buckets: number[];

  constructor(options?: { buckets?: number[] }) {
    this._buckets = options?.buckets ?? DEFAULT_BUCKETS;
  }

  counter(name: string, value = 1, labels: Labels = {}): void {
    const key = label_key(name, labels);
    const existing = this._counters.get(key);
    if (existing) {
      existing.value += value;
    } else {
      this._counters.set(key, { name, labels: { ...labels }, value });
    }
  }

  gauge(name: string, value: number, labels: Labels = {}): void {
    const key = label_key(name, labels);
    const existing = this._gauges.get(key);
    if (existing) {
      existing.value = value;
    } else {
      this._gauges.set(key, { name, labels: { ...labels }, value });
    }
  }

  histogram(name: string, value: number, labels: Labels = {}): void {
    const key = label_key(name, labels);
    let state = this._histograms.get(key);
    if (!state) {
      state = {
        name,
        labels: { ...labels },
        count: 0,
        sum: 0,
        bucket_counts: new Array(this._buckets.length).fill(0) as number[],
        bucket_bounds: [...this._buckets],
      };
      this._histograms.set(key, state);
    }
    state.count++;
    state.sum += value;
    for (let i = 0; i < state.bucket_bounds.length; i++) {
      if (value <= state.bucket_bounds[i]) state.bucket_counts[i]++;
    }
  }

  snapshot(): MetricsSnapshot {
    return {
      counters: [...this._counters.values()].map(c => ({ ...c, labels: { ...c.labels } })),
      gauges: [...this._gauges.values()].map(g => ({ ...g, labels: { ...g.labels } })),
      histograms: [...this._histograms.values()].map(h => ({
        name: h.name,
        labels: { ...h.labels },
        count: h.count,
        sum: h.sum,
        buckets: h.bucket_bounds.map((le, i) => ({ le, count: h.bucket_counts[i] })),
      })),
    };
  }

  /** 전체 메트릭 초기화. 테스트용. */
  reset(): void {
    this._counters.clear();
    this._gauges.clear();
    this._histograms.clear();
  }
}
