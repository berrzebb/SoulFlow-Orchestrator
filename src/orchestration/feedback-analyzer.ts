/** 오케스트레이션 결과 패턴 분석 → Decision/Promise 자동 제안. */

export type FeedbackResult = "success" | "error" | "timeout" | "cancelled";

export type FeedbackEntry = {
  request_summary: string;
  result: FeedbackResult;
  error_pattern?: string;
  provider: string;
  mode: "once" | "agent" | "task";
  tool_calls_count: number;
  duration_ms: number;
};

export type Suggestion = {
  type: "decision" | "promise";
  key: string;
  value: string;
  confidence: number;
  evidence: string[];
};

export type FeedbackAnalyzerOptions = {
  min_samples?: number;
  error_threshold?: number;
  window_size?: number;
};

export class FeedbackAnalyzer {
  private readonly buffer: FeedbackEntry[];
  private write_idx = 0;
  private count = 0;
  private readonly min_samples: number;
  private readonly error_threshold: number;
  private readonly window_size: number;

  constructor(opts?: FeedbackAnalyzerOptions) {
    this.min_samples = opts?.min_samples ?? 5;
    this.error_threshold = opts?.error_threshold ?? 0.4;
    this.window_size = opts?.window_size ?? 100;
    this.buffer = new Array(this.window_size);
  }

  /** O(1) 링 버퍼 삽입. */
  record(entry: FeedbackEntry): void {
    this.buffer[this.write_idx] = entry;
    this.write_idx = (this.write_idx + 1) % this.window_size;
    if (this.count < this.window_size) this.count += 1;
  }

  private get entries(): FeedbackEntry[] {
    if (this.count < this.window_size) return this.buffer.slice(0, this.count);
    return [...this.buffer.slice(this.write_idx), ...this.buffer.slice(0, this.write_idx)];
  }

  analyze(): Suggestion[] {
    if (this.entries.length < this.min_samples) return [];

    const suggestions: Suggestion[] = [];

    const provider_errors = this.analyze_provider_errors();
    suggestions.push(...provider_errors);

    const pattern_errors = this.analyze_error_patterns();
    suggestions.push(...pattern_errors);

    const timeout_patterns = this.analyze_timeout_patterns();
    suggestions.push(...timeout_patterns);

    return suggestions;
  }

  get_stats(): { total: number; error_rate: number; avg_duration_ms: number } {
    if (this.entries.length === 0) return { total: 0, error_rate: 0, avg_duration_ms: 0 };
    const errors = this.entries.filter((e) => e.result !== "success").length;
    const total_duration = this.entries.reduce((sum, e) => sum + e.duration_ms, 0);
    return {
      total: this.entries.length,
      error_rate: errors / this.entries.length,
      avg_duration_ms: Math.round(total_duration / this.entries.length),
    };
  }

  private analyze_provider_errors(): Suggestion[] {
    const by_provider = new Map<string, { total: number; errors: number }>();
    for (const entry of this.entries) {
      const rec = by_provider.get(entry.provider) || { total: 0, errors: 0 };
      rec.total += 1;
      if (entry.result !== "success") rec.errors += 1;
      by_provider.set(entry.provider, rec);
    }

    const suggestions: Suggestion[] = [];
    for (const [provider, stats] of by_provider) {
      if (stats.total < this.min_samples) continue;
      const error_rate = stats.errors / stats.total;
      if (error_rate >= this.error_threshold) {
        suggestions.push({
          type: "decision",
          key: `avoid_provider_${provider}`,
          value: `${provider} 에러율 ${(error_rate * 100).toFixed(0)}% — fallback 프로바이더 우선 사용 권장`,
          confidence: Math.min(1.0, error_rate),
          evidence: [`${provider}: ${stats.errors}/${stats.total} failures`],
        });
      }
    }
    return suggestions;
  }

  private analyze_error_patterns(): Suggestion[] {
    const pattern_counts = new Map<string, number>();
    for (const entry of this.entries) {
      if (entry.error_pattern) {
        const key = entry.error_pattern.slice(0, 100);
        pattern_counts.set(key, (pattern_counts.get(key) || 0) + 1);
      }
    }

    const suggestions: Suggestion[] = [];
    for (const [pattern, count] of pattern_counts) {
      if (count < 3) continue;
      const freq = count / this.entries.length;
      if (freq >= 0.1) {
        suggestions.push({
          type: "promise",
          key: `avoid_error_${sanitize_key(pattern)}`,
          value: `반복 에러 패턴 "${pattern}" — 해당 작업 방식 변경 필요`,
          confidence: Math.min(1.0, freq * 2),
          evidence: [`${count}/${this.entries.length} occurrences of "${pattern}"`],
        });
      }
    }
    return suggestions;
  }

  private analyze_timeout_patterns(): Suggestion[] {
    const timeouts = this.entries.filter((e) => e.result === "timeout");
    if (timeouts.length < 3) return [];

    const timeout_rate = timeouts.length / this.entries.length;
    if (timeout_rate < 0.15) return [];

    const mode_counts = new Map<string, number>();
    for (const t of timeouts) {
      mode_counts.set(t.mode, (mode_counts.get(t.mode) || 0) + 1);
    }

    const worst_mode = [...mode_counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!worst_mode) return [];

    return [{
      type: "decision",
      key: `timeout_mitigation_${worst_mode[0]}`,
      value: `${worst_mode[0]} 모드에서 타임아웃 ${worst_mode[1]}회 — max_turns 축소 또는 작업 분할 권장`,
      confidence: Math.min(1.0, timeout_rate * 2),
      evidence: [`${worst_mode[1]} timeouts in ${worst_mode[0]} mode (${(timeout_rate * 100).toFixed(0)}% overall)`],
    }];
  }
}

function sanitize_key(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40).toLowerCase();
}
