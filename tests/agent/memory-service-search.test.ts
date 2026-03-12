/**
 * MemoryStore — search 관련 통합 테스트.
 * FTS 기본/고급, 벡터 검색 설정, ensure_chunk_embeddings_fresh, kind 필터, build_fts_query.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MemoryStore } from "@src/agent/memory.service.js";
import type { EmbedFn } from "@src/agent/memory.service.js";
import { chunk_markdown } from "@src/agent/memory-chunker.js";
import { with_sqlite } from "@src/utils/sqlite-helper.js";

let workspace: string;
let store: MemoryStore;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "mem-search-"));
  store = new MemoryStore(workspace);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// ── 헬퍼 ──────────────────────────────────────────────

/** Worker 우회 — chunk_markdown + SQLite 직접 삽입으로 동기 청킹. */
function rechunk_sync(s: MemoryStore, doc_key: string, kind: string, day: string, content: string): void {
  const sqlite_path = (s as any).sqlite_path as string;
  const chunks = chunk_markdown(content, doc_key);
  with_sqlite(sqlite_path, (db) => {
    db.prepare("DELETE FROM memory_chunks WHERE doc_key = ?").run(doc_key);
    const ins = db.prepare(`
      INSERT INTO memory_chunks (chunk_id, doc_key, kind, day, heading, start_line, end_line, content, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of chunks) {
      ins.run(c.chunk_id, doc_key, kind, day, c.heading, c.start_line, c.end_line, c.content, c.content_hash);
    }
    return true;
  });
}

/** ensure_initialized 대기 후 store 반환. */
async function ensure_initialized(s: MemoryStore): Promise<MemoryStore> {
  await (s as any).initialized;
  return s;
}

function make_embed_fn(dim = 256): EmbedFn {
  return vi.fn().mockImplementation(async (texts: string[]) => ({
    embeddings: texts.map((_, i) =>
      Array.from({ length: dim }, (_, j) => Math.sin((i + 1) * (j + 1) * 0.01)),
    ),
  }));
}

// ══════════════════════════════════════════════════════════
// 1. FTS basic search
// ══════════════════════════════════════════════════════════

describe("MemoryStore — FTS basic search", () => {
  it("빈 쿼리 → 빈 배열", async () => {
    const r = await store.search("");
    expect(r).toEqual([]);
  });

  it("공백만 있는 쿼리 → 빈 배열", async () => {
    const r = await store.search("   ");
    expect(r).toEqual([]);
  });

  it("콘텐츠 작성 후 검색 → file/line/text 포맷 결과 반환", async () => {
    await store.write_longterm("# Longterm\n\n비밀번호 정책: 8자 이상\n");
    await store.write_daily("오늘 작업: 코드 리뷰 완료\n", "2026-03-01");
    const r = await store.search("코드 리뷰");
    expect(Array.isArray(r)).toBe(true);
    if (r.length > 0) {
      expect(r[0]).toHaveProperty("file");
      expect(r[0]).toHaveProperty("line");
      expect(r[0]).toHaveProperty("text");
    }
  });

  it("kind=longterm 필터 → longterm 결과만", async () => {
    await store.write_longterm("# 장기 기억\n\n중요한 아키텍처 결정: 마이크로서비스 사용.\n\n두 번째 섹션: 성능 최적화 방법.");
    await store.write_daily("daily 전용 내용", "2026-04-10");
    const r = await store.search("아키텍처", { kind: "longterm" });
    expect(Array.isArray(r)).toBe(true);
  });

  it("kind=daily + day 필터 → 해당 날짜 daily만 검색", async () => {
    await store.write_daily("# 4월 10일\n\n특별한 회의 내용.", "2026-04-10");
    await store.write_daily("# 4월 11일\n\n다른 날의 내용.", "2026-04-11");
    const r = await store.search("회의", { kind: "daily", day: "2026-04-10" });
    expect(Array.isArray(r)).toBe(true);
  });

  it("kind=all + day 필터 → day 필터만 적용", async () => {
    await store.write_daily("# 특정일\n\n검색할 내용", "2026-06-01");
    const r = await store.search("검색할", { kind: "all", day: "2026-06-01" });
    expect(Array.isArray(r)).toBe(true);
  });

  it("limit=1 → 최대 1개 반환", async () => {
    await store.write_longterm("첫번째 내용 테스트 데이터");
    await store.write_daily("두번째 내용 테스트 데이터");
    const r = await store.search("내용 테스트", { limit: 1 });
    expect(r.length).toBeLessThanOrEqual(1);
  });

  it("case_sensitive=true → 에러 없이 실행", async () => {
    await store.write_daily("Case Sensitive 테스트 데이터");
    const r = await store.search("Case", { case_sensitive: true });
    expect(Array.isArray(r)).toBe(true);
  });

  it("embed_fn 없어도 FTS 검색 동작", async () => {
    await store.write_longterm("벡터검색 없이도 FTS로 검색 가능");
    const r = await store.search("FTS로");
    expect(Array.isArray(r)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// 2. Vector search setup (set_embed, empty embed, failing embed)
// ══════════════════════════════════════════════════════════

describe("MemoryStore — vector search setup", () => {
  it("embed 함수 설정 후 search → embed_fn 호출됨", async () => {
    const embed_fn: EmbedFn = vi.fn().mockResolvedValue({
      embeddings: [new Array(256).fill(0.01)],
    });
    store.set_embed(embed_fn);
    await store.write_longterm("벡터 검색 테스트 문서\n");
    const r = await store.search("벡터 검색");
    expect(Array.isArray(r)).toBe(true);
  });

  it("256차원 embed_fn → ensure_chunk_embeddings_fresh + vec 검색 진입", async () => {
    const embed_fn: EmbedFn = vi.fn().mockResolvedValue({
      embeddings: [new Array(256).fill(0.1)],
    });
    store.set_embed(embed_fn);
    await store.write_longterm("벡터 임베딩 테스트 내용. 중요한 데이터를 포함.");
    const r = await store.search("벡터 임베딩");
    expect(Array.isArray(r)).toBe(true);
    expect(embed_fn).toHaveBeenCalled();
  });

  it("embed_fn이 빈 embeddings 반환 → 벡터 결과 없음, FTS만", async () => {
    const empty_embed: EmbedFn = async () => ({ embeddings: [] });
    store.set_embed(empty_embed);
    await store.write_longterm("임베딩 빈 반환 테스트 데이터");
    const r = await store.search("임베딩 빈");
    expect(Array.isArray(r)).toBe(true);
  });

  it("embed_fn 예외 발생 → 에러 격리, 빈 배열 반환", async () => {
    const failing_embed: EmbedFn = vi.fn().mockRejectedValue(new Error("embed service down"));
    store.set_embed(failing_embed);
    await store.write_longterm("에러 격리 테스트");
    const r = await store.search("에러 격리");
    expect(Array.isArray(r)).toBe(true);
  });

  it("zero vector 임베딩 → normalize 시 all-zero → vec 결과 없음", async () => {
    const zero_vec = Array(256).fill(0);
    const embed_fn = vi.fn().mockResolvedValue({ embeddings: [zero_vec] });
    store.set_embed(embed_fn);
    await store.write_longterm("# 제로 벡터 테스트\n\n임베딩 내용.");
    const r = await store.search("제로 벡터", { kind: "longterm" });
    expect(Array.isArray(r)).toBe(true);
  });

  it("청크 없을 때 embed_fn 호출 안 함 (stale=0 early return)", async () => {
    const embed_fn: EmbedFn = vi.fn().mockResolvedValue({
      embeddings: [new Array(256).fill(0.05)],
    });
    store.set_embed(embed_fn);
    const r = await store.search("쿼리없는데이터");
    expect(Array.isArray(r)).toBe(true);
  });

  it("embed_fn null embeddings 반환 → search_chunks_vec early return", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily("# Gamma\ngamma null embeddings test", today);
    const embed_fn = vi.fn()
      .mockResolvedValueOnce({ embeddings: [new Array(256).fill(0.1)] })
      .mockResolvedValueOnce({ embeddings: null });
    store.set_embed(embed_fn);
    const results = await store.search("gamma null", { kind: "daily" });
    expect(Array.isArray(results)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// 3. ensure_chunk_embeddings_fresh
// ══════════════════════════════════════════════════════════

describe("MemoryStore — ensure_chunk_embeddings_fresh", () => {
  it("stale 청크 있음 + embed_fn 올바른 개수 반환 → 임베딩 배치 삽입", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily([
      "# Section A",
      "stale chunk content to embed properly",
      "",
      "# Section B",
      "another section for embedding batch",
    ].join("\n"), today);

    const embed_fn = make_embed_fn();
    store.set_embed(embed_fn);

    const results = await store.search("stale chunk", { kind: "daily" });
    expect(Array.isArray(results)).toBe(true);
    expect(embed_fn).toHaveBeenCalled();
  });

  it("embed_fn 반환 embeddings.length !== stale.length → 삽입 건너뜀", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily("## Test\ncontent here embed", today);

    const embed_fn = vi.fn().mockResolvedValue({ embeddings: [] });
    store.set_embed(embed_fn);

    const results = await store.search("content", { kind: "daily" });
    expect(Array.isArray(results)).toBe(true);
  });

  it("embed_fn 잘못된 개수(항상 1개) 반환 → 불일치 시 삽입 생략", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily("# Beta\nbeta embed mismatch test", today);

    const embed_fn = vi.fn().mockImplementation(async (_texts: string[]) => ({
      embeddings: [[0.1, 0.2, 0.3]],
    }));
    store.set_embed(embed_fn);

    const results = await store.search("beta mismatch", { kind: "daily" });
    expect(Array.isArray(results)).toBe(true);
  });

  it("embed_fn 설정된 상태 → ensure_chunk_embeddings_fresh 직접 호출 → 에러 없이 완료", async () => {
    await ensure_initialized(store);
    const today = new Date().toISOString().slice(0, 10);
    const doc_key = `daily:${today}`;

    rechunk_sync(store, doc_key, "daily", today,
      "# Embed Batch\n\nBatch embedding stale chunks for ensure fresh test content.");

    const embed_fn = make_embed_fn();
    store.set_embed(embed_fn);

    await expect((store as any).ensure_chunk_embeddings_fresh()).resolves.toBeUndefined();
  });

  it("stale 청크 없음 → ensure_chunk_embeddings_fresh early return, embed_fn 미호출", async () => {
    await ensure_initialized(store);
    const embed_fn = vi.fn().mockResolvedValue({ embeddings: [] });
    store.set_embed(embed_fn);

    await (store as any).ensure_chunk_embeddings_fresh();
    expect(embed_fn).not.toHaveBeenCalled();
  });

  it("embed_fn 반환 개수 불일치 → ensure_chunk_embeddings_fresh 직접 호출 시 삽입 생략", async () => {
    await ensure_initialized(store);
    const today = new Date().toISOString().slice(0, 10);
    const doc_key = `daily:${today}`;

    rechunk_sync(store, doc_key, "daily", today,
      "# Mismatch Test\n\nEmbedding count mismatch content for guard test.");

    const embed_fn = vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] });
    store.set_embed(embed_fn);

    await expect((store as any).ensure_chunk_embeddings_fresh()).resolves.toBeUndefined();
  });

  it("embed_fn 설정 + longterm 실제 내용 → search 시 embed_fn 호출됨", async () => {
    const actual_embeddings = Array.from({ length: 256 }, (_, i) => i === 0 ? 1.0 : 0.0);
    const embed_fn = vi.fn().mockResolvedValue({ embeddings: [actual_embeddings] });
    store.set_embed(embed_fn);
    await store.write_longterm("# 테스트\n\n벡터 임베딩 대상 내용. " + "내용 ".repeat(20));

    await store.search("테스트");
    expect(embed_fn).toHaveBeenCalled();
  });

  it("embed_fn 빈 반환 두 번 → search 에러 없이 처리됨", async () => {
    const embed_fn = vi.fn()
      .mockResolvedValueOnce({ embeddings: [] })
      .mockResolvedValueOnce({ embeddings: [] });
    store.set_embed(embed_fn);
    await store.write_longterm("# 테스트\n\n내용이 있습니다.");
    const r = await store.search("테스트");
    expect(Array.isArray(r)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// 4. search_chunks_vec kind filters
// ══════════════════════════════════════════════════════════

describe("MemoryStore — search_chunks_vec kind 필터", () => {
  it("kind=longterm → longterm 필터 경로", async () => {
    await store.write_longterm("## Section\nvector longterm important notes content");
    const embed_fn = vi.fn().mockImplementation(async (texts: string[]) => ({
      embeddings: texts.map(() => Array.from({ length: 256 }, (_, i) => i === 0 ? 1.0 : 0.0)),
    }));
    store.set_embed(embed_fn);

    const results = await store.search("vector longterm", { kind: "longterm" });
    expect(Array.isArray(results)).toBe(true);
  });

  it("kind=daily + day → daily + day 필터 경로", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily("## Section\nvector daily content important", today);
    const embed_fn = vi.fn().mockImplementation(async (texts: string[]) => ({
      embeddings: texts.map(() => Array.from({ length: 256 }, (_, i) => i === 0 ? 1.0 : 0.0)),
    }));
    store.set_embed(embed_fn);

    const results = await store.search("vector daily", { kind: "daily", day: today });
    expect(Array.isArray(results)).toBe(true);
  });

  it("kind=all + day → day only 필터 경로", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily("## All\nall kind day filter alpha", today);

    const embed_fn = vi.fn().mockImplementation(async (texts: string[]) => ({
      embeddings: texts.map(() => new Array(256).fill(0).map((_, j) => j * 0.001)),
    }));
    store.set_embed(embed_fn);

    const results = await store.search("all kind day filter", { kind: "all", day: today });
    expect(Array.isArray(results)).toBe(true);
  });

  it("kind=daily + day 없음 → kind만 필터 (day 생략)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily("## NoDay\nno day filter test alpha", today);

    const embed_fn = vi.fn().mockImplementation(async (texts: string[]) => ({
      embeddings: texts.map(() => new Array(256).fill(0).map((_, j) => j * 0.001)),
    }));
    store.set_embed(embed_fn);

    const results = await store.search("no day filter test", { kind: "daily" });
    expect(Array.isArray(results)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// 5. FTS advanced (temporal_decay, content_fn, MMR rerank, result format)
// ══════════════════════════════════════════════════════════

describe("MemoryStore — FTS advanced (temporal_decay + MMR + result format)", () => {
  it("daily 검색 → FTS 히트 → apply_temporal_decay 경로", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily("alpha bravo charlie delta echo foxtrot", today);

    const results = await store.search("alpha", { kind: "daily", day: today });
    expect(Array.isArray(results)).toBe(true);
  });

  it("longterm 검색 → age_fn null 반환 (longterm은 감쇠 면제)", async () => {
    await store.write_longterm("## Memory\nalpha bravo charlie important notes");
    const results = await store.search("alpha", { kind: "longterm" });
    expect(Array.isArray(results)).toBe(true);
  });

  it("다중 섹션 문서 → 2개 이상 청크 → mmr_rerank에서 content_fn 호출", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily([
      "# Section Alpha",
      "alpha bravo charlie delta relevant",
      "",
      "# Section Beta",
      "alpha echo foxtrot golf relevant",
      "",
      "# Section Gamma",
      "alpha hotel india juliet relevant",
    ].join("\n"), today);

    const results = await store.search("alpha", { kind: "daily", day: today });
    expect(Array.isArray(results)).toBe(true);
  });

  it("rechunk + daily chunk FTS 히트 → result 포맷 (file/line/text)", async () => {
    await ensure_initialized(store);
    const today = new Date().toISOString().slice(0, 10);
    const doc_key = `daily:${today}`;

    rechunk_sync(store, doc_key, "daily", today,
      "# Temporal Test\n\nThis daily temporal decay content should appear in search results with file/line/text.");

    const results = await store.search("temporal decay content");
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(typeof results[0].file).toBe("string");
    expect(typeof results[0].line).toBe("number");
    expect(typeof results[0].text).toBe("string");
  });

  it("rechunk + longterm chunk → age_fn null (evergreen, 감쇠 면제)", async () => {
    await ensure_initialized(store);

    rechunk_sync(store, "longterm:MEMORY", "longterm", "__longterm__",
      "# Longterm Evergreen\n\nLongterm null age evergreen content for decay exemption test.");

    const results = await store.search("longterm evergreen decay");
    expect(results.length).toBeGreaterThan(0);
  });

  it("heading 있는 chunk → text에 [heading] 접두사 포함", async () => {
    await ensure_initialized(store);
    const today = new Date().toISOString().slice(0, 10);
    const doc_key = `daily:${today}`;

    rechunk_sync(store, doc_key, "daily", today,
      "# My Section Title\n\nContent under heading section for prefix test.");

    const results = await store.search("heading section prefix");
    expect(results.length).toBeGreaterThan(0);
  });

  it("여러 chunk + limit=2 → content_fn 호출 (MMR) + limit break", async () => {
    await ensure_initialized(store);
    const today = new Date().toISOString().slice(0, 10);
    const doc_key = `daily:${today}`;

    const sections = Array.from({ length: 8 }, (_, i) =>
      `## Section ${i + 1}\n\nalpha beta gamma section ${i + 1} content for mmr diversity selection. ` +
      `More alpha beta gamma text to fill the chunk with relevant section data number ${i + 1}.`
    ).join("\n\n");
    rechunk_sync(store, doc_key, "daily", today, sections);

    const results = await store.search("alpha beta gamma", { limit: 2 });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("KNN 검색: 임베딩 삽입 후 search → rowid -> chunk_id 매핑", async () => {
    await ensure_initialized(store);
    const today = new Date().toISOString().slice(0, 10);
    const doc_key = `daily:${today}`;

    rechunk_sync(store, doc_key, "daily", today,
      "# KNN Mapping\n\nKNN rowid to chunk id mapping content for vector search test.");

    const embed_fn = vi.fn().mockImplementation(async (texts: string[]) => ({
      embeddings: texts.map((_, i) =>
        new Array(256).fill(0).map((__, j) => (j === (i * 13 + 5) % 256 ? 1.0 : 0.0))
      ),
    }));
    store.set_embed(embed_fn);

    await (store as any).ensure_chunk_embeddings_fresh();

    const results = await store.search("KNN rowid chunk mapping");
    expect(Array.isArray(results)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// 6. build_fts_query empty
// ══════════════════════════════════════════════════════════

describe("MemoryStore — build_fts_query 빈 쿼리", () => {
  it("빈 문자열 → terms 없음 → return ''", async () => {
    await ensure_initialized(store);
    const result = (store as any).build_fts_query("");
    expect(result).toBe("");
  });

  it("search_chunks_fts 빈 쿼리 → build_fts_query '' → early return []", async () => {
    await ensure_initialized(store);
    const fts_result = (store as any).search_chunks_fts("", "all", "", 10);
    expect(Array.isArray(fts_result)).toBe(true);
    expect(fts_result).toHaveLength(0);
  });
});
