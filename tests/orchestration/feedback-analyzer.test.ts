/**
 * FeedbackAnalyzer — 전체 커버리지:
 * - record + entries 링 버퍼 (count < window, count >= window)
 * - get_stats: empty, errors, durations
 * - analyze: min_samples 미달, 분기별 제안
 * - analyze_provider_errors: 에러율 >= threshold
 * - analyze_error_patterns: count >= 3 + freq >= 0.1
 * - analyze_timeout_patterns: timeout_rate >= 0.15
 * - sanitize_key
 */
import { describe, it, expect } from "vitest";
import { FeedbackAnalyzer } from "@src/orchestration/feedback-analyzer.js";
import type { FeedbackEntry } from "@src/orchestration/feedback-analyzer.js";

function make_entry(overrides: Partial<FeedbackEntry> = {}): FeedbackEntry {
  return {
    request_summary: "test request",
    result: "success",
    provider: "openrouter",
    mode: "once",
    tool_calls_count: 0,
    duration_ms: 500,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════
// record + get_stats
// ══════════════════════════════════════════════════════════

describe("FeedbackAnalyzer — record + get_stats", () => {
  it("빈 상태 → get_stats 기본값", () => {
    const fa = new FeedbackAnalyzer();
    const stats = fa.get_stats();
    expect(stats).toEqual({ total: 0, error_rate: 0, avg_duration_ms: 0 });
  });

  it("성공 항목 기록 → total=1, error_rate=0", () => {
    const fa = new FeedbackAnalyzer();
    fa.record(make_entry({ duration_ms: 1000 }));
    const stats = fa.get_stats();
    expect(stats.total).toBe(1);
    expect(stats.error_rate).toBe(0);
    expect(stats.avg_duration_ms).toBe(1000);
  });

  it("에러 항목 포함 → error_rate 계산", () => {
    const fa = new FeedbackAnalyzer();
    fa.record(make_entry({ result: "success", duration_ms: 400 }));
    fa.record(make_entry({ result: "error", duration_ms: 600 }));
    const stats = fa.get_stats();
    expect(stats.total).toBe(2);
    expect(stats.error_rate).toBe(0.5);
    expect(stats.avg_duration_ms).toBe(500);
  });

  it("window_size 초과 → 링 버퍼 순환 (count >= window_size)", () => {
    const fa = new FeedbackAnalyzer({ window_size: 3 });
    // window_size=3 초과
    fa.record(make_entry({ provider: "p1" }));
    fa.record(make_entry({ provider: "p2" }));
    fa.record(make_entry({ provider: "p3" }));
    fa.record(make_entry({ provider: "p4" }));  // 이제 count >= window → entries = [...slice(wi), ...slice(0, wi)]

    const stats = fa.get_stats();
    expect(stats.total).toBe(3);  // window_size=3이므로 최근 3개만
  });
});

// ══════════════════════════════════════════════════════════
// analyze — min_samples 미달
// ══════════════════════════════════════════════════════════

describe("FeedbackAnalyzer — analyze min_samples 미달", () => {
  it("샘플 수 < min_samples → 빈 배열 반환", () => {
    const fa = new FeedbackAnalyzer({ min_samples: 5 });
    fa.record(make_entry());
    fa.record(make_entry());
    expect(fa.analyze()).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════
// analyze_provider_errors
// ══════════════════════════════════════════════════════════

describe("FeedbackAnalyzer — analyze_provider_errors", () => {
  it("provider 에러율 >= threshold → decision 제안 반환", () => {
    const fa = new FeedbackAnalyzer({ min_samples: 3, error_threshold: 0.4 });
    // provider "bad_provider": 4/5 에러 → 80% > 40%
    for (let i = 0; i < 4; i++) {
      fa.record(make_entry({ provider: "bad_provider", result: "error" }));
    }
    fa.record(make_entry({ provider: "bad_provider", result: "success" }));
    fa.record(make_entry({ provider: "good_provider", result: "success" }));

    const suggestions = fa.analyze();
    const dec = suggestions.filter((s) => s.type === "decision" && s.key.includes("bad_provider"));
    expect(dec.length).toBeGreaterThan(0);
    expect(dec[0].confidence).toBeGreaterThan(0);
  });

  it("provider 에러율 < threshold → 제안 없음", () => {
    const fa = new FeedbackAnalyzer({ min_samples: 3, error_threshold: 0.8 });
    // 30% 에러 < 80% threshold
    for (let i = 0; i < 7; i++) {
      fa.record(make_entry({ result: "success" }));
    }
    for (let i = 0; i < 3; i++) {
      fa.record(make_entry({ result: "error" }));
    }

    const suggestions = fa.analyze();
    const dec = suggestions.filter((s) => s.type === "decision" && s.key.includes("avoid_provider"));
    expect(dec.length).toBe(0);
  });

  it("provider 샘플 수 < min_samples → 해당 provider 건너뜀", () => {
    const fa = new FeedbackAnalyzer({ min_samples: 5 });
    // 총 5개 넘겨야 analyze() 실행, 하지만 한 provider당 < 5
    for (let i = 0; i < 3; i++) fa.record(make_entry({ provider: "a", result: "error" }));
    for (let i = 0; i < 2; i++) fa.record(make_entry({ provider: "b", result: "error" }));

    const suggestions = fa.analyze();
    expect(suggestions.filter((s) => s.key.includes("avoid_provider"))).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════
// analyze_error_patterns
// ══════════════════════════════════════════════════════════

describe("FeedbackAnalyzer — analyze_error_patterns", () => {
  it("반복 에러 패턴 >= 3회 + freq >= 0.1 → promise 제안", () => {
    const fa = new FeedbackAnalyzer({ min_samples: 5 });
    const pattern = "rate_limit_exceeded";
    for (let i = 0; i < 6; i++) {
      fa.record(make_entry({ result: "error", error_pattern: pattern }));
    }
    for (let i = 0; i < 4; i++) {
      fa.record(make_entry({ result: "success" }));
    }

    const suggestions = fa.analyze();
    const promises = suggestions.filter((s) => s.type === "promise");
    expect(promises.length).toBeGreaterThan(0);
    expect(promises[0].key).toContain("rate_limit_exceeded");
  });

  it("에러 패턴 없음 → promise 제안 없음", () => {
    const fa = new FeedbackAnalyzer({ min_samples: 5 });
    for (let i = 0; i < 5; i++) fa.record(make_entry({ result: "success" }));

    const suggestions = fa.analyze();
    expect(suggestions.filter((s) => s.type === "promise")).toHaveLength(0);
  });

  it("에러 패턴 count < 3 → 제안 없음", () => {
    const fa = new FeedbackAnalyzer({ min_samples: 5 });
    fa.record(make_entry({ result: "error", error_pattern: "rare_error" }));
    fa.record(make_entry({ result: "error", error_pattern: "rare_error" }));
    for (let i = 0; i < 8; i++) fa.record(make_entry({ result: "success" }));

    const suggestions = fa.analyze();
    expect(suggestions.filter((s) => s.type === "promise")).toHaveLength(0);
  });

  it("에러 패턴 freq < 0.1 → 제안 없음", () => {
    const fa = new FeedbackAnalyzer({ min_samples: 5, window_size: 50 });
    // 3회 반복이지만 전체의 3/50 = 6% < 10%
    for (let i = 0; i < 3; i++) fa.record(make_entry({ result: "error", error_pattern: "low_freq" }));
    for (let i = 0; i < 47; i++) fa.record(make_entry({ result: "success" }));

    const suggestions = fa.analyze();
    expect(suggestions.filter((s) => s.type === "promise")).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════
// analyze_timeout_patterns
// ══════════════════════════════════════════════════════════

describe("FeedbackAnalyzer — analyze_timeout_patterns", () => {
  it("timeout >= 3 + rate >= 0.15 → decision 제안 (worst_mode 포함)", () => {
    const fa = new FeedbackAnalyzer({ min_samples: 5 });
    // 5/10 = 50% timeout, mode=task
    for (let i = 0; i < 5; i++) fa.record(make_entry({ result: "timeout", mode: "task" }));
    for (let i = 0; i < 5; i++) fa.record(make_entry({ result: "success" }));

    const suggestions = fa.analyze();
    const dec = suggestions.filter((s) => s.key.includes("timeout_mitigation"));
    expect(dec.length).toBeGreaterThan(0);
    expect(dec[0].key).toContain("task");
  });

  it("timeout 수 < 3 → 제안 없음", () => {
    const fa = new FeedbackAnalyzer({ min_samples: 5 });
    fa.record(make_entry({ result: "timeout" }));
    fa.record(make_entry({ result: "timeout" }));
    for (let i = 0; i < 8; i++) fa.record(make_entry({ result: "success" }));

    const suggestions = fa.analyze();
    expect(suggestions.filter((s) => s.key.includes("timeout_mitigation"))).toHaveLength(0);
  });

  it("timeout rate < 0.15 → 제안 없음", () => {
    const fa = new FeedbackAnalyzer({ min_samples: 5, window_size: 30 });
    // 3/30 = 10% < 15%
    for (let i = 0; i < 3; i++) fa.record(make_entry({ result: "timeout" }));
    for (let i = 0; i < 27; i++) fa.record(make_entry({ result: "success" }));

    const suggestions = fa.analyze();
    expect(suggestions.filter((s) => s.key.includes("timeout_mitigation"))).toHaveLength(0);
  });

  it("여러 mode의 timeout → worst_mode 반환", () => {
    const fa = new FeedbackAnalyzer({ min_samples: 5 });
    // once:2, agent:4, task:1 → agent가 worst
    for (let i = 0; i < 2; i++) fa.record(make_entry({ result: "timeout", mode: "once" }));
    for (let i = 0; i < 4; i++) fa.record(make_entry({ result: "timeout", mode: "agent" }));
    fa.record(make_entry({ result: "timeout", mode: "task" }));
    for (let i = 0; i < 3; i++) fa.record(make_entry({ result: "success" }));

    const suggestions = fa.analyze();
    const dec = suggestions.filter((s) => s.key.includes("timeout_mitigation"));
    expect(dec.length).toBeGreaterThan(0);
    expect(dec[0].key).toContain("agent");
  });
});
