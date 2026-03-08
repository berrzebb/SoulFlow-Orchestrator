/**
 * ProviderHealthScorer — record/score/rank/get_metrics 테스트.
 */
import { describe, it, expect } from "vitest";
import { ProviderHealthScorer } from "../../src/providers/health-scorer.js";

describe("ProviderHealthScorer", () => {
  it("score: 데이터 없으면 1.0 반환", () => {
    const scorer = new ProviderHealthScorer();
    expect(scorer.score("unknown")).toBe(1.0);
  });

  it("record + score: 성공만 있으면 높은 점수", () => {
    const scorer = new ProviderHealthScorer({ latency_target_ms: 1000 });
    scorer.record("p1", { ok: true, latency_ms: 100 });
    scorer.record("p1", { ok: true, latency_ms: 100 });
    const s = scorer.score("p1");
    expect(s).toBeGreaterThan(0.7);
  });

  it("record + score: 실패만 있으면 낮은 점수", () => {
    const scorer = new ProviderHealthScorer();
    scorer.record("p2", { ok: false, latency_ms: 5000 });
    scorer.record("p2", { ok: false, latency_ms: 5000 });
    const s = scorer.score("p2");
    expect(s).toBeLessThan(0.5);
  });

  it("window_size 제한: 오래된 샘플 제거", () => {
    const scorer = new ProviderHealthScorer({ window_size: 3 });
    for (let i = 0; i < 5; i++) scorer.record("p", { ok: true, latency_ms: 10 });
    // window_size=3이므로 최근 3개만 유지 → score 여전히 높음
    expect(scorer.score("p")).toBeGreaterThan(0.5);
  });

  it("rank: 점수 순으로 정렬", () => {
    const scorer = new ProviderHealthScorer({ latency_target_ms: 5000 });
    scorer.record("bad", { ok: false, latency_ms: 9000 });
    scorer.record("bad", { ok: false, latency_ms: 9000 });
    scorer.record("good", { ok: true, latency_ms: 100 });
    scorer.record("good", { ok: true, latency_ms: 100 });
    const ranked = scorer.rank();
    expect(ranked[0].provider).toBe("good");
    expect(ranked[1].provider).toBe("bad");
  });

  it("get_metrics: 기록 없으면 0 반환", () => {
    const scorer = new ProviderHealthScorer();
    const m = scorer.get_metrics("unknown");
    expect(m.success_count).toBe(0);
    expect(m.failure_count).toBe(0);
    expect(m.last_success_at).toBeNull();
    expect(m.last_failure_at).toBeNull();
  });

  it("get_metrics: 성공/실패 카운트 정확", () => {
    const scorer = new ProviderHealthScorer();
    scorer.record("m", { ok: true, latency_ms: 100 });
    scorer.record("m", { ok: true, latency_ms: 200 });
    scorer.record("m", { ok: false, latency_ms: 500 });
    const m = scorer.get_metrics("m");
    expect(m.success_count).toBe(2);
    expect(m.failure_count).toBe(1);
    expect(m.total_latency_ms).toBe(800);
    expect(m.last_success_at).not.toBeNull();
    expect(m.last_failure_at).not.toBeNull();
  });

  it("get_metrics: max_age 초과 샘플 만료 처리", async () => {
    const scorer = new ProviderHealthScorer({ max_age_ms: 5 }); // 5ms TTL
    scorer.record("exp", { ok: true, latency_ms: 50 });
    await new Promise(r => setTimeout(r, 20)); // 만료 대기
    // 만료 후 빈 윈도우 → 1.0
    expect(scorer.score("exp")).toBe(1.0);
  });
});
