/**
 * TR-1~TR-4 계약 테스트 — TokenizerPolicy, QueryNormalizer, LexicalProfile, LanguageRuleLike.
 */
import { describe, it, expect } from "vitest";
import {
  Unicode61Tokenizer,
  DEFAULT_TOKENIZER,
  UNICODE61_PROFILE,
  TOOL_INDEX_PROFILE,
  MEMORY_CHUNK_PROFILE,
  build_fts5_tokenize_clause,
  build_bm25_call,
  ENGLISH_RULES,
  KOREAN_RULES,
  CHINESE_RULES,
  detect_language_rule,
} from "../../src/search/index.js";
import type {
  TokenizerPolicyLike,
  QueryNormalizerLike,
  LexicalProfile,
  TokenizerAdapterLike,
  LanguageRuleLike,
} from "../../src/search/index.js";

// ── TokenizerPolicyLike 계약 ────────────────────────────────────────────────

describe("TokenizerPolicyLike contract", () => {
  const tokenizer: TokenizerPolicyLike = new Unicode61Tokenizer();

  it("영어 텍스트를 소문자 토큰으로 분할", () => {
    const tokens = tokenizer.tokenize("Hello World Test");
    expect(tokens).toContain("hello");
    expect(tokens).toContain("world");
    expect(tokens).toContain("test");
  });

  it("한국어 조사를 탈락시키고 어간 추출", () => {
    const tokens = tokenizer.tokenize("데이터베이스에서 검색을 수행");
    // "데이터베이스에서" → "데이터베이스" (조사 "에서" 탈락)
    expect(tokens).toContain("데이터베이스");
    // "검색을" → "검색" (조사 "을" 탈락)
    expect(tokens).toContain("검색");
  });

  it("중국어 텍스트를 유니그램 + 바이그램으로 분할", () => {
    const tokens = tokenizer.tokenize("数据库");
    expect(tokens).toContain("数");
    expect(tokens).toContain("据");
    expect(tokens).toContain("库");
    expect(tokens).toContain("数据");
    expect(tokens).toContain("据库");
  });

  it("빈 문자열은 빈 배열 반환", () => {
    expect(tokenizer.tokenize("")).toEqual([]);
    expect(tokenizer.tokenize("   ")).toEqual([]);
  });

  it("영어 불용어를 올바르게 식별", () => {
    expect(tokenizer.is_stop_word("the")).toBe(true);
    expect(tokenizer.is_stop_word("is")).toBe(true);
    expect(tokenizer.is_stop_word("database")).toBe(false);
  });

  it("한국어 불용어를 올바르게 식별", () => {
    expect(tokenizer.is_stop_word("은")).toBe(true);
    expect(tokenizer.is_stop_word("하다")).toBe(true);
    expect(tokenizer.is_stop_word("데이터")).toBe(false);
  });
});

// ── QueryNormalizerLike 계약 ────────────────────────────────────────────────

describe("QueryNormalizerLike contract", () => {
  const normalizer: QueryNormalizerLike = new Unicode61Tokenizer();

  it("불용어를 제거하고 의미 있는 키워드만 추출", () => {
    const keywords = normalizer.extract_keywords("find the database connection error");
    expect(keywords).toContain("database");
    expect(keywords).toContain("connection");
    expect(keywords).toContain("error");
    expect(keywords).not.toContain("the");
    expect(keywords).not.toContain("find");
  });

  it("한국어 + 영어 혼합 쿼리에서 키워드 추출", () => {
    const keywords = normalizer.extract_keywords("데이터베이스에서 error를 검색");
    expect(keywords).toContain("데이터베이스");
    expect(keywords).toContain("error");
    expect(keywords).toContain("검색");
  });

  it("FTS5 MATCH 쿼리를 OR 결합으로 생성", () => {
    const fts = normalizer.build_fts_query("database connection error");
    expect(fts).toContain("database");
    expect(fts).toContain("connection");
    expect(fts).toContain("error");
    expect(fts).toContain(" OR ");
  });

  it("모든 단어가 불용어인 경우 원문 AND 쿼리로 폴백", () => {
    const fts = normalizer.build_fts_query("the is a");
    // 불용어만 → 원문 AND 폴백
    expect(fts).toBeTruthy();
    expect(fts).not.toContain(" OR ");
  });

  it("빈 쿼리는 빈 문자열 반환", () => {
    expect(normalizer.build_fts_query("")).toBe("");
    expect(normalizer.build_fts_query("   ")).toBe("");
  });

  it("FTS5 특수문자(쌍따옴표)를 이스케이프", () => {
    const fts = normalizer.build_fts_query('search "quoted" term');
    // 쌍따옴표가 이스케이프되어야 함
    expect(fts).not.toContain('""quoted""');
    expect(fts).toContain("search");
    expect(fts).toContain("term");
  });
});

// ── LexicalProfile 계약 ─────────────────────────────────────────────────────

describe("LexicalProfile contract", () => {
  it("UNICODE61_PROFILE이 기본 tokenize 절을 가짐", () => {
    expect(UNICODE61_PROFILE.fts5_tokenize).toBe("unicode61 remove_diacritics 2");
    expect(UNICODE61_PROFILE.bm25_weights).toBeUndefined();
  });

  it("TOOL_INDEX_PROFILE이 3-column BM25 가중치를 가짐", () => {
    expect(TOOL_INDEX_PROFILE.bm25_weights).toEqual([5.0, 2.0, 1.0]);
  });

  it("build_fts5_tokenize_clause가 올바른 SQL 절 생성", () => {
    expect(build_fts5_tokenize_clause(UNICODE61_PROFILE))
      .toBe("tokenize='unicode61 remove_diacritics 2'");
  });

  it("build_bm25_call — 가중치 있는 프로파일", () => {
    expect(build_bm25_call(TOOL_INDEX_PROFILE, "tools_fts"))
      .toBe("bm25(tools_fts, 5, 2, 1)");
  });

  it("build_bm25_call — 가중치 없는 프로파일", () => {
    expect(build_bm25_call(MEMORY_CHUNK_PROFILE, "mem_fts"))
      .toBe("bm25(mem_fts)");
  });
});

// ── TokenizerAdapterLike 확장 계약 ──────────────────────────────────────────

describe("TokenizerAdapterLike contract (stub adapter)", () => {
  /** ICU 어댑터 스텁 — 계약이 구현 가능한지 증명. */
  class StubIcuAdapter implements TokenizerAdapterLike {
    readonly adapter_name = "icu-stub";
    readonly supported_languages = ["ko", "ja", "zh"] as const;

    tokenize(text: string): string[] {
      return text.toLowerCase().split(/\s+/).filter(Boolean);
    }
    is_stop_word(_token: string): boolean { return false; }
    detect_language(text: string): string | null {
      if (/[\uac00-\ud7af]/.test(text)) return "ko";
      if (/[\u4e00-\u9fff]/.test(text)) return "zh";
      return null;
    }
  }

  it("어댑터 메타데이터 접근 가능", () => {
    const adapter: TokenizerAdapterLike = new StubIcuAdapter();
    expect(adapter.adapter_name).toBe("icu-stub");
    expect(adapter.supported_languages).toContain("ko");
  });

  it("언어 감지 동작", () => {
    const adapter = new StubIcuAdapter();
    expect(adapter.detect_language("한국어 텍스트")).toBe("ko");
    expect(adapter.detect_language("中文文本")).toBe("zh");
    expect(adapter.detect_language("English text")).toBeNull();
  });

  it("TokenizerPolicyLike 호환", () => {
    const policy: TokenizerPolicyLike = new StubIcuAdapter();
    expect(policy.tokenize("hello world")).toEqual(["hello", "world"]);
  });
});

// ── DEFAULT_TOKENIZER 싱글턴 ────────────────────────────────────────────────

describe("DEFAULT_TOKENIZER singleton", () => {
  it("Unicode61Tokenizer 인스턴스", () => {
    expect(DEFAULT_TOKENIZER).toBeInstanceOf(Unicode61Tokenizer);
  });

  it("TokenizerPolicyLike + QueryNormalizerLike 양쪽 만족", () => {
    const tp: TokenizerPolicyLike = DEFAULT_TOKENIZER;
    const qn: QueryNormalizerLike = DEFAULT_TOKENIZER;
    expect(tp.tokenize("test")).toEqual(["test"]);
    expect(qn.extract_keywords("test")).toEqual(["test"]);
  });
});

// ── 소비자 마이그레이션 통합 회귀 ──────────────────────────────────────────

describe("소비자 마이그레이션 회귀: memory-query-expansion", () => {
  it("extract_query_keywords가 DEFAULT_TOKENIZER를 사용", async () => {
    const { extract_query_keywords } = await import("../../src/agent/memory-query-expansion.js");
    const keywords = extract_query_keywords("데이터베이스에서 error를 검색");
    expect(keywords).toContain("데이터베이스");
    expect(keywords).toContain("error");
    expect(keywords).toContain("검색");
  });

  it("build_fts_query_expanded가 DEFAULT_TOKENIZER를 사용", async () => {
    const { build_fts_query_expanded } = await import("../../src/agent/memory-query-expansion.js");
    const fts = build_fts_query_expanded("database connection");
    expect(fts).toMatch(/"database" OR "connection"/);
  });

  it("한국어 조사 탈락이 공유 토크나이저와 동일", async () => {
    const { extract_query_keywords } = await import("../../src/agent/memory-query-expansion.js");
    const from_consumer = extract_query_keywords("데이터베이스에서");
    const from_tokenizer = DEFAULT_TOKENIZER.extract_keywords("데이터베이스에서");
    expect(from_consumer).toEqual(from_tokenizer);
  });
});

describe("소비자 마이그레이션 회귀: tool-index FTS5 profile", () => {
  it("TOOL_INDEX_PROFILE이 unicode61 remove_diacritics 2 tokenizer를 가짐", () => {
    expect(TOOL_INDEX_PROFILE.fts5_tokenize).toBe("unicode61 remove_diacritics 2");
  });

  it("tool-index.ts의 INIT_SQL이 LexicalProfile을 참조 (정적 분석)", async () => {
    // tool-index.ts가 build_fts5_tokenize_clause를 import하는지 정적 검증
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const content = readFileSync(join(__dirname, "..", "..", "src", "orchestration", "tool-index.ts"), "utf-8");
    expect(content).toContain("build_fts5_tokenize_clause");
    expect(content).toContain("TOOL_INDEX_PROFILE");
    // 하드코딩된 tokenize 절이 남아있지 않은지 확인
    expect(content).not.toContain("tokenize='unicode61 remove_diacritics 2'");
  });

  it("memory-query-expansion.ts가 DEFAULT_TOKENIZER를 import (정적 분석)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const content = readFileSync(join(__dirname, "..", "..", "src", "agent", "memory-query-expansion.ts"), "utf-8");
    expect(content).toContain("DEFAULT_TOKENIZER");
    // 자체 tokenize 함수가 남아있지 않은지 확인
    expect(content).not.toContain("function tokenize(");
    expect(content).not.toContain("STOP_WORDS_EN");
    expect(content).not.toContain("STOP_WORDS_KO");
  });
});

// ── LanguageRuleLike 계약 ───────────────────────────────────────────────

describe("LanguageRuleLike contract — 언어 규칙 분리", () => {
  it("ENGLISH_RULES가 LanguageRuleLike 만족", () => {
    const rule: LanguageRuleLike = ENGLISH_RULES;
    expect(rule.lang).toBe("en");
    expect(rule.tokenize_segment("hello")).toEqual(["hello"]);
    expect(rule.is_stop_word("the")).toBe(true);
    expect(rule.is_stop_word("database")).toBe(false);
    expect(rule.is_valid_keyword("db")).toBe(false); // 2글자 영어 → invalid
    expect(rule.is_valid_keyword("database")).toBe(true);
  });

  it("KOREAN_RULES가 조사 탈락 포함", () => {
    const rule: LanguageRuleLike = KOREAN_RULES;
    expect(rule.lang).toBe("ko");
    expect(rule.matches_script("데이터")).toBe(true);
    expect(rule.matches_script("hello")).toBe(false);
    const tokens = rule.tokenize_segment("데이터베이스에서");
    expect(tokens).toContain("데이터베이스");
    expect(rule.is_stop_word("오늘")).toBe(true);
    expect(rule.is_stop_word("서울")).toBe(false);
  });

  it("CHINESE_RULES가 유니그램 + 바이그램 생성", () => {
    const rule: LanguageRuleLike = CHINESE_RULES;
    expect(rule.lang).toBe("zh");
    expect(rule.matches_script("数据")).toBe(true);
    const tokens = rule.tokenize_segment("数据库");
    expect(tokens).toContain("数");
    expect(tokens).toContain("数据");
    expect(tokens).toContain("据库");
  });

  it("detect_language_rule가 스크립트에 맞는 규칙 반환", () => {
    expect(detect_language_rule("데이터")).toBe(KOREAN_RULES);
    expect(detect_language_rule("数据")).toBe(CHINESE_RULES);
    expect(detect_language_rule("hello")).toBe(ENGLISH_RULES);
  });

  it("새 언어 규칙이 LanguageRuleLike 계약을 만족 (stub Japanese)", () => {
    const JA_RULES: LanguageRuleLike = {
      lang: "ja",
      matches_script: (s) => /[\u3040-\u309f\u30a0-\u30ff]/.test(s),
      tokenize_segment: (s) => [s],
      is_stop_word: () => false,
      is_valid_keyword: (t) => t.length >= 1,
    };
    expect(JA_RULES.matches_script("こんにちは")).toBe(true);
    expect(JA_RULES.tokenize_segment("テスト")).toEqual(["テスト"]);
  });
});

// ── TR-3 소비자 회귀: memory-scoring ─────────────────────────────────────

describe("소비자 마이그레이션 회귀: memory-scoring (TR-3)", () => {
  it("memory-scoring.ts가 자체 tokenize_simple을 제거하고 DEFAULT_TOKENIZER 사용 (정적 분석)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const content = readFileSync(join(__dirname, "..", "..", "src", "agent", "memory-scoring.ts"), "utf-8");
    expect(content).toContain("DEFAULT_TOKENIZER");
    expect(content).not.toContain("function tokenize_simple");
    expect(content).not.toContain("[^a-z0-9가-힣\\s]");
  });
});

// ── TR-4 소비자 회귀: session-reuse ──────────────────────────────────────

describe("소비자 마이그레이션 회귀: session-reuse (TR-4)", () => {
  it("session-reuse.ts가 DEFAULT_TOKENIZER를 import (정적 분석)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const content = readFileSync(
      join(__dirname, "..", "..", "src", "orchestration", "guardrails", "session-reuse.ts"),
      "utf-8",
    );
    expect(content).toContain("DEFAULT_TOKENIZER");
    // 자체 정규화 로직이 남아있지 않은지 확인
    expect(content).not.toContain("[^\\p{L}\\p{N}\\s]");
    expect(content).not.toContain(".toLowerCase()");
  });

  it("normalize_query가 DEFAULT_TOKENIZER와 동일한 토큰화 결과", async () => {
    const { normalize_query } = await import(
      "../../src/orchestration/guardrails/session-reuse.js"
    );
    const from_reuse = normalize_query("데이터베이스에서 검색을 수행");
    const from_tokenizer = DEFAULT_TOKENIZER.tokenize("데이터베이스에서 검색을 수행").join(" ");
    expect(from_reuse).toBe(from_tokenizer);
  });
});
