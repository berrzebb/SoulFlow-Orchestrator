import { describe, it, expect, beforeEach } from "vitest";
import { FeedbackAnalyzer, type FeedbackEntry } from "@src/orchestration/feedback-analyzer.ts";

function entry(overrides: Partial<FeedbackEntry> = {}): FeedbackEntry {
  return {
    request_summary: "test request",
    result: "success",
    provider: "phi4_local",
    mode: "once",
    tool_calls_count: 0,
    duration_ms: 500,
    ...overrides,
  };
}

describe("FeedbackAnalyzer", () => {
  let analyzer: FeedbackAnalyzer;

  beforeEach(() => {
    analyzer = new FeedbackAnalyzer({ min_samples: 5, error_threshold: 0.4, window_size: 50 });
  });

  it("샘플 부족 → 빈 suggestion", () => {
    analyzer.record(entry({ result: "error" }));
    expect(analyzer.analyze()).toEqual([]);
  });

  it("프로바이더 에러율 초과 → decision 제안", () => {
    for (let i = 0; i < 5; i++) {
      analyzer.record(entry({ provider: "chatgpt", result: "error" }));
    }
    const suggestions = analyzer.analyze();
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions[0].type).toBe("decision");
    expect(suggestions[0].key).toContain("chatgpt");
  });

  it("에러율 낮으면 제안 없음", () => {
    for (let i = 0; i < 10; i++) {
      analyzer.record(entry({ provider: "phi4_local", result: "success" }));
    }
    const suggestions = analyzer.analyze();
    expect(suggestions.filter((s) => s.key.includes("phi4_local"))).toHaveLength(0);
  });

  it("반복 에러 패턴 → promise 제안", () => {
    for (let i = 0; i < 5; i++) {
      analyzer.record(entry({ result: "error", error_pattern: "tool_not_found" }));
    }
    const suggestions = analyzer.analyze();
    const promise_suggestions = suggestions.filter((s) => s.type === "promise");
    expect(promise_suggestions.length).toBeGreaterThanOrEqual(1);
    expect(promise_suggestions[0].key).toContain("tool_not_found");
  });

  it("타임아웃 패턴 → decision 제안", () => {
    for (let i = 0; i < 4; i++) {
      analyzer.record(entry({ result: "timeout", mode: "task" }));
    }
    analyzer.record(entry({ result: "success" }));
    const suggestions = analyzer.analyze();
    const timeout_suggestions = suggestions.filter((s) => s.key.includes("timeout"));
    expect(timeout_suggestions.length).toBeGreaterThanOrEqual(1);
    expect(timeout_suggestions[0].value).toContain("task");
  });

  it("get_stats — 정확한 집계", () => {
    analyzer.record(entry({ result: "success", duration_ms: 100 }));
    analyzer.record(entry({ result: "error", duration_ms: 300 }));

    const stats = analyzer.get_stats();
    expect(stats.total).toBe(2);
    expect(stats.error_rate).toBe(0.5);
    expect(stats.avg_duration_ms).toBe(200);
  });

  it("get_stats — 빈 상태", () => {
    const stats = analyzer.get_stats();
    expect(stats.total).toBe(0);
    expect(stats.error_rate).toBe(0);
  });

  it("윈도우 크기 제한", () => {
    const small = new FeedbackAnalyzer({ min_samples: 1, window_size: 5 });
    for (let i = 0; i < 10; i++) {
      small.record(entry());
    }
    expect(small.get_stats().total).toBe(5);
  });

  it("confidence — 에러율 반영", () => {
    for (let i = 0; i < 5; i++) {
      analyzer.record(entry({ provider: "bad_provider", result: "error" }));
    }
    const suggestions = analyzer.analyze();
    const s = suggestions.find((s) => s.key.includes("bad_provider"));
    expect(s).toBeDefined();
    expect(s!.confidence).toBeGreaterThan(0.5);
  });
});
