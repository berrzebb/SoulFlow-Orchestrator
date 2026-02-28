/** 프로바이더별 건강 점수 — 슬라이딩 윈도우 성공률 + 레이턴시 기반. */

export type ProviderMetrics = {
  success_count: number;
  failure_count: number;
  total_latency_ms: number;
  last_success_at: string | null;
  last_failure_at: string | null;
};

export type HealthScorerOptions = {
  window_size?: number;
  latency_weight?: number;
  success_weight?: number;
  latency_target_ms?: number;
  max_age_ms?: number;
};

type Sample = { ok: boolean; latency_ms: number; at: number };

export class ProviderHealthScorer {
  private readonly window_size: number;
  private readonly latency_weight: number;
  private readonly success_weight: number;
  private readonly latency_target_ms: number;
  private readonly max_age_ms: number;
  private readonly windows = new Map<string, Sample[]>();

  constructor(opts?: HealthScorerOptions) {
    this.window_size = opts?.window_size ?? 50;
    this.latency_weight = opts?.latency_weight ?? 0.3;
    this.success_weight = opts?.success_weight ?? 0.7;
    this.latency_target_ms = opts?.latency_target_ms ?? 5000;
    this.max_age_ms = opts?.max_age_ms ?? 600_000;
  }

  record(provider: string, result: { ok: boolean; latency_ms: number }): void {
    let window = this.windows.get(provider);
    if (!window) {
      window = [];
      this.windows.set(provider, window);
    }
    window.push({ ok: result.ok, latency_ms: result.latency_ms, at: Date.now() });
    if (window.length > this.window_size) {
      window.splice(0, window.length - this.window_size);
    }
  }

  private prune_expired(window: Sample[]): Sample[] {
    const cutoff = Date.now() - this.max_age_ms;
    return window.filter((s) => s.at >= cutoff);
  }

  score(provider: string): number {
    const raw = this.windows.get(provider);
    if (!raw || raw.length === 0) return 1.0;
    const window = this.prune_expired(raw);
    if (window.length !== raw.length) {
      if (window.length === 0) { this.windows.delete(provider); return 1.0; }
      this.windows.set(provider, window);
    }
    if (window.length === 0) return 1.0;

    const success_count = window.filter((s) => s.ok).length;
    const success_rate = success_count / window.length;

    const avg_latency = window.reduce((sum, s) => sum + s.latency_ms, 0) / window.length;
    const latency_score = this.latency_target_ms > 0
      ? Math.max(0, 1 - avg_latency / this.latency_target_ms)
      : 0;

    return this.success_weight * success_rate + this.latency_weight * latency_score;
  }

  rank(): Array<{ provider: string; score: number }> {
    const providers = [...this.windows.keys()];
    return providers
      .map((p) => ({ provider: p, score: this.score(p) }))
      .sort((a, b) => b.score - a.score);
  }

  get_metrics(provider: string): ProviderMetrics {
    const window = this.windows.get(provider);
    if (!window || window.length === 0) {
      return { success_count: 0, failure_count: 0, total_latency_ms: 0, last_success_at: null, last_failure_at: null };
    }

    const success_count = window.filter((s) => s.ok).length;
    const failure_count = window.length - success_count;
    const total_latency_ms = window.reduce((sum, s) => sum + s.latency_ms, 0);
    const last_success = window.filter((s) => s.ok).at(-1);
    const last_failure = window.filter((s) => !s.ok).at(-1);

    return {
      success_count,
      failure_count,
      total_latency_ms,
      last_success_at: last_success ? new Date(last_success.at).toISOString() : null,
      last_failure_at: last_failure ? new Date(last_failure.at).toISOString() : null,
    };
  }
}
