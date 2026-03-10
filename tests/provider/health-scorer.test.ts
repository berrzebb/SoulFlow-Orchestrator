import { describe, it, expect, beforeEach, vi } from "vitest";
import { ProviderHealthScorer } from "@src/providers/health-scorer.ts";

describe("ProviderHealthScorer", () => {
  let scorer: ProviderHealthScorer;

  beforeEach(() => {
    scorer = new ProviderHealthScorer({
      window_size: 10,
      latency_weight: 0.3,
      success_weight: 0.7,
      latency_target_ms: 5000,
    });
  });

  it("기록 없는 프로바이더 → score 1.0", () => {
    expect(scorer.score("orchestrator_llm")).toBe(1.0);
  });

  it("100% 성공 + 낮은 레이턴시 → score ≈ 1.0", () => {
    for (let i = 0; i < 5; i++) {
      scorer.record("orchestrator_llm", { ok: true, latency_ms: 100 });
    }
    const s = scorer.score("orchestrator_llm");
    expect(s).toBeGreaterThan(0.9);
  });

  it("100% 실패 → score ≈ 0", () => {
    for (let i = 0; i < 5; i++) {
      scorer.record("chatgpt", { ok: false, latency_ms: 10000 });
    }
    const s = scorer.score("chatgpt");
    expect(s).toBeLessThan(0.1);
  });

  it("50% 성공률 → score 중간", () => {
    for (let i = 0; i < 4; i++) {
      scorer.record("openrouter", { ok: true, latency_ms: 200 });
      scorer.record("openrouter", { ok: false, latency_ms: 200 });
    }
    const s = scorer.score("openrouter");
    expect(s).toBeGreaterThan(0.3);
    expect(s).toBeLessThan(0.7);
  });

  it("슬라이딩 윈도우 — 오래된 데이터 퇴거", () => {
    // window_size=10이므로 11개 기록하면 첫번째 제거
    for (let i = 0; i < 10; i++) {
      scorer.record("orchestrator_llm", { ok: false, latency_ms: 5000 });
    }
    const before = scorer.score("orchestrator_llm");

    // 이제 성공을 10개 추가 → 실패 데이터 전부 밀려남
    for (let i = 0; i < 10; i++) {
      scorer.record("orchestrator_llm", { ok: true, latency_ms: 100 });
    }
    const after = scorer.score("orchestrator_llm");

    expect(after).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(0.9);
  });

  it("rank() — 점수 높은 순 정렬", () => {
    scorer.record("good", { ok: true, latency_ms: 100 });
    scorer.record("bad", { ok: false, latency_ms: 10000 });
    scorer.record("mid", { ok: true, latency_ms: 4000 });

    const ranked = scorer.rank();
    expect(ranked[0].provider).toBe("good");
    expect(ranked[ranked.length - 1].provider).toBe("bad");
  });

  it("get_metrics — 정확한 집계", () => {
    scorer.record("test", { ok: true, latency_ms: 100 });
    scorer.record("test", { ok: true, latency_ms: 200 });
    scorer.record("test", { ok: false, latency_ms: 300 });

    const m = scorer.get_metrics("test");
    expect(m.success_count).toBe(2);
    expect(m.failure_count).toBe(1);
    expect(m.total_latency_ms).toBe(600);
    expect(m.last_success_at).not.toBeNull();
    expect(m.last_failure_at).not.toBeNull();
  });

  it("get_metrics — 기록 없으면 빈 메트릭", () => {
    const m = scorer.get_metrics("unknown");
    expect(m.success_count).toBe(0);
    expect(m.last_success_at).toBeNull();
  });

  it("높은 레이턴시 → 점수 감소", () => {
    scorer.record("fast", { ok: true, latency_ms: 100 });
    scorer.record("slow", { ok: true, latency_ms: 4500 });

    expect(scorer.score("fast")).toBeGreaterThan(scorer.score("slow"));
  });
});

describe("ProviderHealthScorer — 전체 만료 (L62)", () => {
  it("모든 항목 만료 후 score() → windows 삭제 + 1.0 반환 (L62)", () => {
    vi.useFakeTimers();
    const scorer = new ProviderHealthScorer({ window_size: 10, max_age_ms: 100 });
    // T=0: 항목 2개 기록
    scorer.record("all_expired", { ok: false, latency_ms: 5000 });
    scorer.record("all_expired", { ok: false, latency_ms: 5000 });
    // T=200ms: 전부 만료
    vi.advanceTimersByTime(200);
    // score() → window.length=0 → L62: delete + return 1.0
    const s = scorer.score("all_expired");
    expect(s).toBe(1.0);
    vi.useRealTimers();
  });
});

describe("ProviderHealthScorer — 부분 만료 (L63)", () => {
  it("일부 항목 만료 후 score() → windows 업데이트 (L63)", () => {
    vi.useFakeTimers();
    const scorer = new ProviderHealthScorer({ window_size: 10, max_age_ms: 100 });
    // T=0: 오래된 2개 기록
    scorer.record("aged_provider", { ok: true, latency_ms: 100 });
    scorer.record("aged_provider", { ok: false, latency_ms: 200 });
    // T=200ms: max_age_ms 초과 → 위 2개 만료
    vi.advanceTimersByTime(200);
    // 새 항목 1개 (만료 안 됨)
    scorer.record("aged_provider", { ok: true, latency_ms: 50 });
    // score() 호출 → raw.length=3, window.length=1 → L63: windows.set
    const s = scorer.score("aged_provider");
    expect(s).toBeGreaterThan(0.9); // 최근 1개 성공
    vi.useRealTimers();
  });
});
