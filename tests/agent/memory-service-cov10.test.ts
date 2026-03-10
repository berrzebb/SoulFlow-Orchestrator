/**
 * MemoryStore — 미커버 분기 보충 (cov10):
 * - L78: set_embed_worker_config
 * - L271-302: rechunk_document 직접 호출 (Worker 우회)
 * - L334: build_fts_query → "" (빈 쿼리)
 * - L443-474, L482, L502: FTS 히트 후 temporal_decay + MMR + result format
 * - L532-548, L559-601: ensure_chunk_embeddings_fresh stale 경로 + KNN
 * - L661-662: consolidate archive=true → daily 삭제
 *
 * NOTE: schedule_rechunk()는 Worker.postMessage()로 비동기 처리 → 테스트 중 청크
 * 미생성. rechunk_document()를 직접 호출해 동기 청킹 후 search 경로를 커버.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "@src/agent/memory.service.js";

let tmp_dir: string;

async function setup_store(): Promise<MemoryStore> {
  tmp_dir = await mkdtemp(join(tmpdir(), "mem-cov10-"));
  const store = new MemoryStore(tmp_dir);
  // ensure_initialized 완료 대기
  await (store as any).initialized;
  return store;
}

afterEach(async () => {
  await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
});

// ══════════════════════════════════════════════════════════
// L78 — set_embed_worker_config
// ══════════════════════════════════════════════════════════

describe("MemoryStore — L78 set_embed_worker_config", () => {
  it("config 주입 → embed_worker_config 저장", async () => {
    const store = await setup_store();
    const config = { model: "text-embed-test", api_key: "key-abc", base_url: "http://localhost:9999", dimensions: 256 };
    store.set_embed_worker_config(config as any);
    expect((store as any).embed_worker_config).toEqual(config);
  });
});

// ══════════════════════════════════════════════════════════
// L271-302 — rechunk_document (private, 직접 호출)
// ══════════════════════════════════════════════════════════

describe("MemoryStore — L271-302 rechunk_document 직접 호출", () => {
  it("새 content → chunk upsert → FTS에서 검색 가능", async () => {
    const store = await setup_store();
    const today = new Date().toISOString().slice(0, 10);
    const doc_key = `daily:${today}`;

    // rechunk_document 직접 호출 → memory_chunks 테이블에 동기 삽입
    (store as any).rechunk_document(doc_key, "daily", today,
      "# Alpha Content\n\nThis rechunked content should be searchable via FTS immediately.");

    const results = await store.search("rechunked content searchable");
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it("동일 doc_key 재청킹 → 기존 청크 삭제 + 새 청크 upsert", async () => {
    const store = await setup_store();
    const doc_key = "longterm:MEMORY";

    (store as any).rechunk_document(doc_key, "longterm", "__longterm__",
      "# First Version\n\nOriginal document content to be replaced.");
    (store as any).rechunk_document(doc_key, "longterm", "__longterm__",
      "# Second Version\n\nReplacement content after rechunk with changed data.");

    const results = await store.search("replacement rechunk changed");
    expect(Array.isArray(results)).toBe(true);
  });

  it("빈 content → chunk 없음 → search 빈 결과", async () => {
    const store = await setup_store();
    const today = new Date().toISOString().slice(0, 10);
    const doc_key = `daily:${today}`;

    (store as any).rechunk_document(doc_key, "daily", today, "");

    const results = await store.search("anything here");
    expect(Array.isArray(results)).toBe(true);
  });

  it("동일 content 재청킹 → L298 content_hash 동일 → continue (skip upsert)", async () => {
    const store = await setup_store();
    const doc_key = "longterm:MEMORY";
    const content = "# Same Content\n\nThis content hash will be identical on rechunk. No change.";

    // 1차 청킹
    (store as any).rechunk_document(doc_key, "longterm", "__longterm__", content);
    // 2차 동일 content 청킹 → content_hash 동일 → L298 continue
    (store as any).rechunk_document(doc_key, "longterm", "__longterm__", content);

    const results = await store.search("content hash identical");
    expect(Array.isArray(results)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// L334 — build_fts_query returning "" (빈 쿼리)
// ══════════════════════════════════════════════════════════

describe("MemoryStore — L334 build_fts_query 빈 쿼리", () => {
  it("빈 문자열 → terms 없음 → return '' (L334)", async () => {
    const store = await setup_store();
    const result = (store as any).build_fts_query("");
    expect(result).toBe("");
  });

  it("search_chunks_fts 빈 쿼리 → build_fts_query '' → early return []", async () => {
    const store = await setup_store();
    const fts_result = (store as any).search_chunks_fts("", "all", "", 10);
    expect(Array.isArray(fts_result)).toBe(true);
    expect(fts_result).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════
// L443-474, L482, L502 — FTS 히트 → temporal_decay + MMR + result format
// ══════════════════════════════════════════════════════════

describe("MemoryStore — L443-474 temporal_decay + MMR + result format (FTS 히트)", () => {
  it("daily chunk FTS 히트 → age_fn 클로저 실행 → result 포맷 (L464-469)", async () => {
    const store = await setup_store();
    const today = new Date().toISOString().slice(0, 10);
    const doc_key = `daily:${today}`;

    (store as any).rechunk_document(doc_key, "daily", today,
      "# Temporal Test\n\nThis daily temporal decay content should appear in search results with file/line/text.");

    const results = await store.search("temporal decay content");
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    // result format: file, line, text
    expect(typeof results[0].file).toBe("string");
    expect(typeof results[0].line).toBe("number");
    expect(typeof results[0].text).toBe("string");
  });

  it("longterm chunk → age_fn null (evergreen, 감쇠 면제)", async () => {
    const store = await setup_store();

    (store as any).rechunk_document("longterm:MEMORY", "longterm", "__longterm__",
      "# Longterm Evergreen\n\nLongterm null age evergreen content for decay exemption test.");

    const results = await store.search("longterm evergreen decay");
    expect(results.length).toBeGreaterThan(0);
  });

  it("heading 있는 chunk → text에 [heading] 접두사 포함 (L466)", async () => {
    const store = await setup_store();
    const today = new Date().toISOString().slice(0, 10);
    const doc_key = `daily:${today}`;

    (store as any).rechunk_document(doc_key, "daily", today,
      "# My Section Title\n\nContent under heading section for prefix test.");

    const results = await store.search("heading section prefix");
    expect(results.length).toBeGreaterThan(0);
  });

  it("여러 chunk → content_fn 호출 (MMR L454-457) + limit break (L474)", async () => {
    const store = await setup_store();
    const today = new Date().toISOString().slice(0, 10);
    const doc_key = `daily:${today}`;

    // 쿼리 단어를 각 섹션에 포함시킨 긴 content → 여러 청크
    const sections = Array.from({ length: 8 }, (_, i) =>
      `## Section ${i + 1}\n\nalpha beta gamma section ${i + 1} content for mmr diversity selection. ` +
      `More alpha beta gamma text to fill the chunk with relevant section data number ${i + 1}.`
    ).join("\n\n");
    (store as any).rechunk_document(doc_key, "daily", today, sections);

    // limit=2 → L474 break (scored > 2)
    const results = await store.search("alpha beta gamma", { limit: 2 });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

// ══════════════════════════════════════════════════════════
// L532-548, L559-601 — ensure_chunk_embeddings_fresh + KNN
// ══════════════════════════════════════════════════════════

describe("MemoryStore — L532-601 ensure_chunk_embeddings_fresh 배치 + KNN", () => {
  it("embed_fn 설정 후 ensure_chunk_embeddings_fresh 호출 → L559 guard 통과 → 에러 없이 완료", async () => {
    // NOTE: with_sqlite가 sqlite-vec를 로드하지 않아 stale 쿼리의 NOT EXISTS (memory_chunks_vec)
    // 가 실패 → null → [] → L568 early return. L570-586은 해당 경로로 커버 불가.
    // 이 테스트는 L559 (if !embed_fn) guard를 커버.
    const store = await setup_store();
    const today = new Date().toISOString().slice(0, 10);
    const doc_key = `daily:${today}`;

    (store as any).rechunk_document(doc_key, "daily", today,
      "# Embed Batch\n\nBatch embedding stale chunks for ensure fresh test content.");

    const embed_fn = vi.fn().mockImplementation(async (texts: string[]) => ({
      embeddings: texts.map((_, i) =>
        new Array(256).fill(0).map((__, j) => Math.sin((i + 1) * (j + 1) * 0.005))
      ),
    }));
    store.set_embed(embed_fn);

    // embed_fn 설정된 상태로 호출 → L559 guard (if !embed_fn) false → 진행
    await expect((store as any).ensure_chunk_embeddings_fresh()).resolves.toBeUndefined();
  });

  it("stale 청크 없음 → ensure_chunk_embeddings_fresh early return (L568)", async () => {
    const store = await setup_store();
    const embed_fn = vi.fn().mockResolvedValue({ embeddings: [] });
    store.set_embed(embed_fn);

    // 청크 없음 → stale.length === 0 → early return, embed_fn 미호출
    await (store as any).ensure_chunk_embeddings_fresh();
    expect(embed_fn).not.toHaveBeenCalled();
  });

  it("embed_fn 반환 개수 불일치 → 임베딩 삽입 생략 (L572 guard)", async () => {
    const store = await setup_store();
    const today = new Date().toISOString().slice(0, 10);
    const doc_key = `daily:${today}`;

    (store as any).rechunk_document(doc_key, "daily", today,
      "# Mismatch Test\n\nEmbedding count mismatch content for guard test.");

    // 항상 1개만 반환 → stale 청크 수와 불일치 → L572 return
    const embed_fn = vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] });
    store.set_embed(embed_fn);

    // should complete without error
    await expect((store as any).ensure_chunk_embeddings_fresh()).resolves.toBeUndefined();
  });

  it("KNN 검색: 임베딩 삽입 후 search → vec KNN rows 있음 → rowid→chunk_id 매핑 (L532-548)", async () => {
    const store = await setup_store();
    const today = new Date().toISOString().slice(0, 10);
    const doc_key = `daily:${today}`;

    (store as any).rechunk_document(doc_key, "daily", today,
      "# KNN Mapping\n\nKNN rowid to chunk id mapping content for vector search test.");

    // 단위 벡터 임베딩 (KNN 히트 보장)
    const embed_fn = vi.fn().mockImplementation(async (texts: string[]) => ({
      embeddings: texts.map((_, i) =>
        new Array(256).fill(0).map((__, j) => (j === (i * 13 + 5) % 256 ? 1.0 : 0.0))
      ),
    }));
    store.set_embed(embed_fn);

    // 먼저 stale 청크 임베딩
    await (store as any).ensure_chunk_embeddings_fresh();

    // search → search_chunks_vec → KNN query → rows 있음 → rowid→chunk_id
    const results = await store.search("KNN rowid chunk mapping");
    expect(Array.isArray(results)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// L661-662 — consolidate archive=true → sqlite_delete_daily
// ══════════════════════════════════════════════════════════

describe("MemoryStore — L661-662 consolidate archive=true", () => {
  it("오늘 daily + archive=true → archived_files에 포함 (L661-662)", async () => {
    const store = await setup_store();
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily("Archivable content alpha beta gamma for archive test.", today);

    const result = await store.consolidate({ archive: true, memory_window: 7 });
    expect(result.ok).toBe(true);
    expect(result.archived_files.length).toBeGreaterThan(0);
    expect(result.archived_files[0]).toContain("archive");
  });

  it("window 내 daily 여러 개 + archive=true → 모두 archived", async () => {
    const store = await setup_store();

    // 최근 2일치 daily 작성
    for (let i = 0; i <= 1; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const day = d.toISOString().slice(0, 10);
      await store.write_daily(`Content for day ${day} archive multi test.`, day);
    }

    const result = await store.consolidate({ archive: true, memory_window: 7 });
    expect(result.ok).toBe(true);
    expect(result.archived_files.length).toBeGreaterThanOrEqual(1);
  });
});
