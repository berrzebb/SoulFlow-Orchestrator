import { describe, it, expect } from "vitest";
import {
  normalize_query,
  compute_similarity,
  evaluate_reuse,
  EMPTY_EVIDENCE,
  type SessionEvidenceSnapshot,
  type ReuseEvaluationOptions,
} from "../../../src/orchestration/guardrails/session-reuse.js";

const NOW = 1_700_000_000_000;
const FRESH = 300_000; // 5분

function make_evidence(
  entries: Array<{ query: string; age_ms: number; had_tool_calls?: boolean }>,
): SessionEvidenceSnapshot {
  return {
    recent_queries: entries.map((e) => ({
      normalized: normalize_query(e.query),
      original: e.query,
      timestamp_ms: NOW - e.age_ms,
      had_tool_calls: e.had_tool_calls ?? true,
    })),
  };
}

const DEFAULT_OPTS: ReuseEvaluationOptions = {
  freshness_window_ms: FRESH,
  similarity_threshold: 0.85,
};

describe("normalize_query", () => {
  it("소문자 변환 + 공백 정리", () => {
    expect(normalize_query("  Hello   World  ")).toBe("hello world");
  });

  it("구두점 제거", () => {
    expect(normalize_query("What's the weather?")).toBe("what s the weather");
  });

  it("빈 문자열", () => {
    expect(normalize_query("")).toBe("");
    expect(normalize_query("   ")).toBe("");
  });

  it("유니코드 보존", () => {
    expect(normalize_query("날씨 어때?")).toBe("날씨 어때");
  });
});

describe("compute_similarity", () => {
  it("동일 문자열 → 1.0", () => {
    expect(compute_similarity("hello world", "hello world")).toBe(1.0);
  });

  it("완전 불일치 → 0.0", () => {
    expect(compute_similarity("hello", "goodbye")).toBe(0.0);
  });

  it("부분 일치 → 0 < sim < 1", () => {
    const sim = compute_similarity("weather today", "weather tomorrow");
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it("빈 문자열 양쪽 → 1.0", () => {
    expect(compute_similarity("", "")).toBe(1.0);
  });

  it("한쪽만 빈 문자열 → 0.0", () => {
    expect(compute_similarity("hello", "")).toBe(0.0);
  });

  it("어순 무관 (Jaccard)", () => {
    const sim = compute_similarity("a b c", "c b a");
    expect(sim).toBe(1.0);
  });
});

describe("evaluate_reuse — same-query fixtures", () => {
  it("정확히 같은 질의 + fresh → reuse_summary", () => {
    const evidence = make_evidence([{ query: "날씨 알려줘", age_ms: 60_000 }]);
    const result = evaluate_reuse("날씨 알려줘", evidence, NOW, DEFAULT_OPTS);
    expect(result.kind).toBe("reuse_summary");
    if (result.kind === "reuse_summary") {
      expect(result.age_ms).toBe(60_000);
    }
  });

  it("같은 질의 + 대소문자/공백 차이 → reuse_summary", () => {
    const evidence = make_evidence([{ query: "What is the Weather", age_ms: 120_000 }]);
    const result = evaluate_reuse("what  is  the  weather", evidence, NOW, DEFAULT_OPTS);
    expect(result.kind).toBe("reuse_summary");
  });

  it("같은 질의 + stale → stale_retry", () => {
    const evidence = make_evidence([{ query: "날씨 알려줘", age_ms: 600_000 }]); // 10분
    const result = evaluate_reuse("날씨 알려줘", evidence, NOW, DEFAULT_OPTS);
    expect(result.kind).toBe("stale_retry");
  });
});

describe("evaluate_reuse — synonym-query fixtures", () => {
  it("유사 질의 (단어 겹침 높음) + fresh → same_topic", () => {
    const evidence = make_evidence([{ query: "오늘 서울 날씨 어때", age_ms: 120_000 }]);
    // 토크나이저가 "오늘"(KO 불용어)을 제거하므로:
    // evidence: "서울 날씨 어때" / incoming: "서울 날씨" → Jaccard 2/3 ≈ 0.667
    const opts = { ...DEFAULT_OPTS, similarity_threshold: 0.6 };
    const result = evaluate_reuse("서울 오늘 날씨", evidence, NOW, opts);
    expect(result.kind).toBe("same_topic");
  });

  it("한국어 조사 탈락으로 near-duplicate 감지 향상", () => {
    // "데이터베이스에서" → 조사 "에서" 탈락 → "데이터베이스에서 데이터베이스"
    // "데이터베이스 검색" → "데이터베이스 검색"
    // 조사 탈락 덕분에 "데이터베이스"가 교집합에 포함됨
    const evidence = make_evidence([{ query: "데이터베이스에서 검색", age_ms: 60_000 }]);
    const opts = { ...DEFAULT_OPTS, similarity_threshold: 0.5 };
    const result = evaluate_reuse("데이터베이스 검색", evidence, NOW, opts);
    expect(result.kind).not.toBe("new_search");
  });

  it("유사도 미달 → new_search", () => {
    const evidence = make_evidence([{ query: "날씨 알려줘", age_ms: 60_000 }]);
    const result = evaluate_reuse("주식 시세 보여줘", evidence, NOW, DEFAULT_OPTS);
    expect(result.kind).toBe("new_search");
  });
});

describe("evaluate_reuse — stale-vs-fresh fixtures", () => {
  it("freshness window 경계 — 정확히 boundary → fresh", () => {
    const evidence = make_evidence([{ query: "test query", age_ms: FRESH }]);
    const result = evaluate_reuse("test query", evidence, NOW, DEFAULT_OPTS);
    expect(result.kind).toBe("reuse_summary");
  });

  it("freshness window 경계 — 1ms 초과 → stale", () => {
    const evidence = make_evidence([{ query: "test query", age_ms: FRESH + 1 }]);
    const result = evaluate_reuse("test query", evidence, NOW, DEFAULT_OPTS);
    expect(result.kind).toBe("stale_retry");
  });

  it("freshness_window_ms = 0 → disabled (항상 stale)", () => {
    const evidence = make_evidence([{ query: "test query", age_ms: 1_000 }]);
    const opts = { ...DEFAULT_OPTS, freshness_window_ms: 0 };
    const result = evaluate_reuse("test query", evidence, NOW, opts);
    expect(result.kind).toBe("stale_retry");
  });
});

describe("evaluate_reuse — edge cases", () => {
  it("빈 evidence → new_search", () => {
    const result = evaluate_reuse("hello", EMPTY_EVIDENCE, NOW, DEFAULT_OPTS);
    expect(result.kind).toBe("new_search");
  });

  it("빈 질의 → new_search", () => {
    const evidence = make_evidence([{ query: "test", age_ms: 60_000 }]);
    const result = evaluate_reuse("", evidence, NOW, DEFAULT_OPTS);
    expect(result.kind).toBe("new_search");
  });

  it("여러 매칭 → 가장 유사한 것 선택", () => {
    const evidence = make_evidence([
      { query: "weather forecast today", age_ms: 60_000 },
      { query: "weather today", age_ms: 120_000 },
    ]);
    const opts = { ...DEFAULT_OPTS, similarity_threshold: 0.5 };
    const result = evaluate_reuse("weather today", evidence, NOW, opts);
    expect(result.kind).toBe("reuse_summary");
    if (result.kind === "reuse_summary") {
      expect(result.matched_query).toBe("weather today");
    }
  });

  it("여러 매칭 동일 유사도 → 더 최근 것 선택", () => {
    const evidence = make_evidence([
      { query: "hello world", age_ms: 200_000 },
      { query: "hello world", age_ms: 60_000 },
    ]);
    const result = evaluate_reuse("hello world", evidence, NOW, DEFAULT_OPTS);
    expect(result.kind).toBe("reuse_summary");
    if (result.kind === "reuse_summary") {
      expect(result.age_ms).toBe(60_000);
    }
  });
});
