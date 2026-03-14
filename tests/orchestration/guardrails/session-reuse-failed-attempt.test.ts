/**
 * EG-R1: Failed-Attempt-Aware Session Reuse.
 *
 * 실패/중단 응답은 reuse 근거에서 제외하고,
 * 재시도 의도를 감지하여 bypass하는 회귀 테스트.
 */

import { describe, it, expect } from "vitest";
import {
  normalize_query,
  evaluate_reuse,
  type SessionEvidenceSnapshot,
  type ReuseEvaluationOptions,
} from "../../../src/orchestration/guardrails/session-reuse.js";
import {
  build_session_evidence,
} from "../../../src/orchestration/guardrails/enforcement.js";

const NOW = 1_700_000_000_000;
const FRESH = 300_000;
const DEFAULT_OPTS: ReuseEvaluationOptions = {
  freshness_window_ms: FRESH,
  similarity_threshold: 0.85,
};

// ── build_session_evidence: 실패 응답 제외 ──

describe("build_session_evidence — failed attempt exclusion", () => {
  it("assistant 응답이 없는 user 메시지 → failed_queries로 분류", () => {
    const snap = build_session_evidence(
      [
        { role: "user", content: "실패한 질문" },
        // assistant 응답 없음 (중단)
        { role: "user", content: "현재 질문" },
      ],
      NOW, FRESH,
    );
    expect(snap.recent_queries).toHaveLength(0);
    expect(snap.failed_queries).toHaveLength(1);
    expect(snap.failed_queries[0].original).toBe("실패한 질문");
  });

  it("assistant 응답이 빈 문자열 → failed_queries로 분류", () => {
    const snap = build_session_evidence(
      [
        { role: "user", content: "빈 응답 질문" },
        { role: "assistant", content: "" },
        { role: "user", content: "현재 질문" },
      ],
      NOW, FRESH,
    );
    expect(snap.recent_queries).toHaveLength(0);
    expect(snap.failed_queries).toHaveLength(1);
    expect(snap.failed_queries[0].original).toBe("빈 응답 질문");
  });

  it("assistant 응답이 정상 → recent_queries로 분류", () => {
    const snap = build_session_evidence(
      [
        { role: "user", content: "성공한 질문" },
        { role: "assistant", content: "정상 응답입니다" },
        { role: "user", content: "현재 질문" },
      ],
      NOW, FRESH,
    );
    expect(snap.recent_queries).toHaveLength(1);
    expect(snap.recent_queries[0].original).toBe("성공한 질문");
    expect(snap.failed_queries).toHaveLength(0);
  });

  it("혼합 시나리오: 성공 + 실패 → 각각 분류", () => {
    const snap = build_session_evidence(
      [
        { role: "user", content: "질문1" },
        { role: "assistant", content: "답변1" },
        { role: "user", content: "질문2" },
        { role: "assistant", content: "" },
        { role: "user", content: "질문3" },
        // 응답 없음
        { role: "user", content: "현재 질문" },
      ],
      NOW, FRESH,
    );
    expect(snap.recent_queries).toHaveLength(1);
    expect(snap.recent_queries[0].original).toBe("질문1");
    expect(snap.failed_queries).toHaveLength(2);
    expect(snap.failed_queries.map(q => q.original)).toEqual(["질문2", "질문3"]);
  });

  it("빈 히스토리 → 빈 failed_queries", () => {
    const snap = build_session_evidence([], NOW, FRESH);
    expect(snap.failed_queries).toHaveLength(0);
  });
});

// ── build_session_evidence: 실제 타임스탬프 ──

describe("build_session_evidence — real timestamps", () => {
  it("timestamp_ms가 있으면 합성 타임스탬프 대신 사용", () => {
    const real_ts = NOW - 120_000;
    const snap = build_session_evidence(
      [
        { role: "user", content: "질문", timestamp_ms: real_ts },
        { role: "assistant", content: "답변" },
        { role: "user", content: "현재" },
      ],
      NOW, FRESH,
    );
    expect(snap.recent_queries).toHaveLength(1);
    expect(snap.recent_queries[0].timestamp_ms).toBe(real_ts);
  });

  it("timestamp_ms가 없으면 기존 합성 타임스탬프 사용", () => {
    const snap = build_session_evidence(
      [
        { role: "user", content: "질문" },
        { role: "assistant", content: "답변" },
        { role: "user", content: "현재" },
      ],
      NOW, FRESH,
    );
    expect(snap.recent_queries).toHaveLength(1);
    const ts = snap.recent_queries[0].timestamp_ms;
    expect(ts).toBeGreaterThanOrEqual(NOW - FRESH);
    expect(ts).toBeLessThanOrEqual(NOW);
  });
});

// ── evaluate_reuse: 재시도 의도 bypass ──

describe("evaluate_reuse — retry intent bypass", () => {
  function make_evidence_with_failures(
    succeeded: Array<{ query: string; age_ms: number }>,
    failed: Array<{ query: string; age_ms: number }>,
  ): SessionEvidenceSnapshot {
    return {
      recent_queries: succeeded.map(e => ({
        normalized: normalize_query(e.query),
        original: e.query,
        timestamp_ms: NOW - e.age_ms,
        had_tool_calls: true,
      })),
      failed_queries: failed.map(e => ({
        normalized: normalize_query(e.query),
        original: e.query,
        timestamp_ms: NOW - e.age_ms,
      })),
    };
  }

  it("실패한 질의 재시도 → new_search (reuse bypass)", () => {
    const evidence = make_evidence_with_failures(
      [],
      [{ query: "날씨 알려줘", age_ms: 30_000 }],
    );
    const result = evaluate_reuse("날씨 알려줘", evidence, NOW, DEFAULT_OPTS);
    expect(result.kind).toBe("new_search");
  });

  it("성공한 질의 반복 → reuse_summary (기존 동작 유지)", () => {
    const evidence = make_evidence_with_failures(
      [{ query: "날씨 알려줘", age_ms: 60_000 }],
      [],
    );
    const result = evaluate_reuse("날씨 알려줘", evidence, NOW, DEFAULT_OPTS);
    expect(result.kind).toBe("reuse_summary");
  });

  it("동일 질의가 성공+실패 둘 다 → 재시도 의도 우선 (new_search)", () => {
    const evidence = make_evidence_with_failures(
      [{ query: "날씨 알려줘", age_ms: 120_000 }],
      [{ query: "날씨 알려줘", age_ms: 30_000 }],
    );
    const result = evaluate_reuse("날씨 알려줘", evidence, NOW, DEFAULT_OPTS);
    expect(result.kind).toBe("new_search");
  });

  it("유사한 실패 질의 → new_search (near-duplicate retry)", () => {
    const evidence = make_evidence_with_failures(
      [],
      [{ query: "서울 날씨 어때", age_ms: 30_000 }],
    );
    const opts = { ...DEFAULT_OPTS, similarity_threshold: 0.6 };
    const result = evaluate_reuse("서울 오늘 날씨", evidence, NOW, opts);
    expect(result.kind).toBe("new_search");
  });

  it("failed_queries가 없으면 기존 로직 그대로", () => {
    const evidence: SessionEvidenceSnapshot = {
      recent_queries: [{
        normalized: normalize_query("test query"),
        original: "test query",
        timestamp_ms: NOW - 60_000,
        had_tool_calls: true,
      }],
    };
    const result = evaluate_reuse("test query", evidence, NOW, DEFAULT_OPTS);
    expect(result.kind).toBe("reuse_summary");
  });

  it("stale 실패 질의 → new_search (stale여도 재시도 허용)", () => {
    const evidence = make_evidence_with_failures(
      [],
      [{ query: "날씨 알려줘", age_ms: 600_000 }],
    );
    const result = evaluate_reuse("날씨 알려줘", evidence, NOW, DEFAULT_OPTS);
    expect(result.kind).toBe("new_search");
  });
});
