/**
 * TR-5: TokenizerEvalExecutor + tokenizer bundle 테스트.
 *
 * - tokenize 5개 시나리오 (영어, 한국어 조사 탈락, 한국어 불용어, 중국어 바이그램, 혼합 스크립트)
 * - extract_keywords 2개 시나리오 (영어, 한국어)
 * - build_fts_query 2개 시나리오 (영어, 한국어)
 * - normalize_query 1개 시나리오
 * - rrf_merge 1개 시나리오
 * - mmr_rerank 1개 시나리오 (다양성 리랭킹)
 * - 에러 처리 2개
 * - 번들 등록 + eval runner 통합
 */
import { describe, it, expect, beforeEach } from "vitest";
import { create_tokenizer_executor } from "@src/evals/tokenizer-executor.js";
import {
  clear_registry, register_bundle, get_bundle,
  load_bundle_datasets,
} from "@src/evals/bundles.js";
import { EvalRunner } from "@src/evals/runner.js";
import { EXACT_MATCH_SCORER } from "@src/evals/scorers.js";

const executor = create_tokenizer_executor();

// ── tokenize ──

describe("tokenizer executor — tokenize", () => {
  it("영어 기본 토큰화", async () => {
    const result = await executor.execute(JSON.stringify({ type: "tokenize", text: "Hello World" }));
    expect(result.output).toBe("hello world");
    expect(result.error).toBeUndefined();
  });

  it("한국어 조사 탈락 — 원형+조사형 동시 출력", async () => {
    const result = await executor.execute(JSON.stringify({ type: "tokenize", text: "데이터베이스에서 검색" }));
    expect(result.output).toBe("데이터베이스에서 데이터베이스 검색");
  });

  it("한국어 불용어 필터링", async () => {
    const result = await executor.execute(JSON.stringify({ type: "tokenize", text: "오늘 서울 날씨" }));
    expect(result.output).toBe("서울 날씨");
  });

  it("중국어 유니그램 + 바이그램", async () => {
    const result = await executor.execute(JSON.stringify({ type: "tokenize", text: "机器学习" }));
    expect(result.output).toBe("机 器 学 习 机器 器学 学习");
  });

  it("혼합 스크립트 자동 감지", async () => {
    const result = await executor.execute(JSON.stringify({ type: "tokenize", text: "Seoul 날씨 good" }));
    expect(result.output).toBe("seoul 날씨 good");
  });
});

// ── extract_keywords ──

describe("tokenizer executor — extract_keywords", () => {
  it("영어 불용어 필터링 후 키워드", async () => {
    const result = await executor.execute(JSON.stringify({ type: "extract_keywords", query: "the quick brown fox jumps" }));
    expect(result.output).toBe("quick brown fox jumps");
  });

  it("한국어 키워드 — 불용어 제거 + 조사 탈락 원형", async () => {
    const result = await executor.execute(JSON.stringify({ type: "extract_keywords", query: "오늘 서울에서 날씨 검색" }));
    expect(result.output).toBe("서울에서 서울 날씨 검색");
  });
});

// ── build_fts_query ──

describe("tokenizer executor — build_fts_query", () => {
  it("영어 FTS5 쿼리 — 불용어 제외", async () => {
    const result = await executor.execute(JSON.stringify({ type: "build_fts_query", query: "the quick brown fox" }));
    expect(result.output).toBe('"quick" OR "brown" OR "fox"');
  });

  it("한국어 FTS5 쿼리 — 조사 탈락 원형 포함", async () => {
    const result = await executor.execute(JSON.stringify({ type: "build_fts_query", query: "오늘 서울에서 날씨" }));
    expect(result.output).toBe('"서울에서" OR "서울" OR "날씨"');
  });
});

// ── normalize_query ──

describe("tokenizer executor — normalize_query", () => {
  it("불용어 + 구두점 제거 정규화", async () => {
    const result = await executor.execute(JSON.stringify({ type: "normalize_query", query: "오늘 서울 날씨 어때?" }));
    expect(result.output).toBe("서울 날씨 어때");
  });
});

// ── rrf_merge ──

describe("tokenizer executor — rrf_merge", () => {
  it("겹치는 랭킹 융합 — 양쪽 등장 문서 최상위", async () => {
    const result = await executor.execute(JSON.stringify({
      type: "rrf_merge",
      fts_ranked: ["doc1", "doc2", "doc3"],
      vec_ranked: ["doc3", "doc1"],
    }));
    expect(result.output).toBe("doc1,doc3,doc2");
  });
});

// ── mmr_rerank ──

describe("tokenizer executor — mmr_rerank", () => {
  it("다양성 리랭킹 — 유사 항목 대신 다른 주제 선택", async () => {
    const result = await executor.execute(JSON.stringify({
      type: "mmr_rerank",
      items: [
        { id: "a", score: 1.0, content: "hello world foo" },
        { id: "b", score: 0.9, content: "hello world bar" },
        { id: "c", score: 0.8, content: "completely different topic" },
      ],
      limit: 2,
      lambda: 0.5,
    }));
    expect(result.output).toBe("a,c");
  });
});

// ── 에러 처리 ──

describe("tokenizer executor — error handling", () => {
  it("잘못된 JSON → error", async () => {
    const result = await executor.execute("not json");
    expect(result.error).toBeTruthy();
    expect(result.output).toBe("");
  });

  it("알 수 없는 type → error", async () => {
    const result = await executor.execute(JSON.stringify({ type: "unknown" }));
    expect(result.error).toContain("unknown tokenizer eval type");
  });
});

// ── bundle + eval runner 통합 ──

describe("tokenizer bundle", () => {
  beforeEach(() => { clear_registry(); });

  it("tokenizer 번들 등록 + 데이터셋 로드", () => {
    register_bundle({
      name: "tokenizer",
      description: "토크나이저/하이브리드 검색 회귀 평가",
      dataset_files: ["tests/evals/cases/tokenizer.json"],
      smoke: true,
      tags: ["smoke"],
    });
    const bundle = get_bundle("tokenizer");
    expect(bundle).toBeTruthy();
    const datasets = load_bundle_datasets(bundle!);
    expect(datasets).toHaveLength(1);
    expect(datasets[0].name).toBe("tokenizer");
    expect(datasets[0].cases).toHaveLength(12);
  });

  it("eval runner 통합 — 전체 12 케이스 통과", async () => {
    register_bundle({
      name: "tokenizer",
      description: "토크나이저/하이브리드 검색 회귀 평가",
      dataset_files: ["tests/evals/cases/tokenizer.json"],
      smoke: true,
    });
    const datasets = load_bundle_datasets(get_bundle("tokenizer")!);
    const runner = new EvalRunner(executor, EXACT_MATCH_SCORER);
    const summary = await runner.run_dataset(datasets[0]);
    expect(summary.total).toBe(12);
    expect(summary.passed).toBe(12);
    expect(summary.failed).toBe(0);
    expect(summary.error_count).toBe(0);
  });
});
