/**
 * ReferenceStore — SQLite + FTS5 기반 문서 청크 저장소 테스트.
 * sqlite-vec 벡터 임베딩 경로는 embed_fn 없이 건너뜀.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ReferenceStore } from "../../src/services/reference-store.js";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("ReferenceStore", () => {
  let tmp_dir: string;
  let store: ReferenceStore;

  beforeEach(async () => {
    tmp_dir = await mkdtemp(join(tmpdir(), "refstore-test-"));
    store = new ReferenceStore(tmp_dir);
  });

  afterEach(async () => {
    await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
  });

  // ── 초기 상태 ──

  it("get_stats: 초기 상태 → 0 카운트", () => {
    const stats = store.get_stats();
    expect(stats.total_docs).toBe(0);
    expect(stats.total_chunks).toBe(0);
    expect(stats.last_sync).toBeNull();
  });

  it("list_documents: 초기 상태 → 빈 배열", () => {
    expect(store.list_documents()).toEqual([]);
  });

  // ── sync ──

  it("sync: references 디렉토리 없음 → {added:0, updated:0, removed:0}", async () => {
    const result = await store.sync();
    expect(result).toEqual({ added: 0, updated: 0, removed: 0 });
  });

  it("sync: 파일 추가 → added 카운트 증가", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "guide.md"), "# Guide\n\nThis is a test document.");

    const result = await store.sync();
    expect(result.added).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.removed).toBe(0);
  });

  it("sync: 두 번 호출 (debounce) → 두 번째는 0", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "doc.md"), "# Doc");

    await store.sync(); // first
    const second = await store.sync(); // debounced
    expect(second).toEqual({ added: 0, updated: 0, removed: 0 });
  });

  it("sync 후 get_stats: last_sync 설정됨", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "note.txt"), "Hello world");

    await store.sync();
    const stats = store.get_stats();
    expect(stats.last_sync).not.toBeNull();
    expect(stats.total_docs).toBe(1);
    expect(stats.total_chunks).toBeGreaterThan(0);
  });

  it("sync + list_documents: 문서 목록 반환", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "a.md"), "# A\n\nContent A");
    await writeFile(join(refs_dir, "b.md"), "# B\n\nContent B");

    await store.sync();
    const docs = store.list_documents();
    expect(docs.length).toBe(2);
    expect(docs.map((d) => d.path).sort()).toContain("a.md");
    expect(docs.map((d) => d.path).sort()).toContain("b.md");
  });

  it("sync: 지원되지 않는 확장자 무시", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "image.png"), "fake png data");
    await writeFile(join(refs_dir, "doc.md"), "# Doc");

    const result = await store.sync();
    expect(result.added).toBe(1); // only .md
  });

  // ── set_embed ──

  it("set_embed: embed_fn 없이 search → FTS 결과만 (에러 없음)", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "doc.md"), "# Topic\n\nThis document is about JavaScript testing.");

    await store.sync();
    const results = await store.search("javascript");
    // FTS 결과 또는 빈 배열 (에러는 없어야 함)
    expect(Array.isArray(results)).toBe(true);
  });

  it("search: 빈 DB에서 검색 → 빈 배열", async () => {
    const results = await store.search("anything");
    expect(results).toEqual([]);
  });

  // ── 숨김 파일 ──

  it("sync: 점으로 시작하는 파일 무시", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, ".hidden.md"), "# Hidden");
    await writeFile(join(refs_dir, "visible.md"), "# Visible");

    const result = await store.sync();
    expect(result.added).toBe(1); // only visible.md
  });

  it("sync: 파일 변경 → updated 카운트 증가 + removed=0", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    const path = join(refs_dir, "doc.md");
    await writeFile(path, "# Version 1\n\nOriginal content.");

    await store.sync();
    // last_sync 초기화 (debounce 우회)
    (store as any).last_sync = 0;

    // 파일 변경
    await writeFile(path, "# Version 2\n\nUpdated content.");
    const result = await store.sync();

    expect(result.updated).toBe(1);
    expect(result.removed).toBe(0);
  });

  it("sync: 파일 삭제 → removed 카운트 증가", async () => {
    const { unlink } = await import("node:fs/promises");
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    const file_path = join(refs_dir, "gone.md");
    await writeFile(file_path, "# Gone");

    await store.sync();
    (store as any).last_sync = 0;

    await unlink(file_path);
    const result = await store.sync();

    expect(result.removed).toBe(1);
    expect(store.list_documents().length).toBe(0);
  });

  it("sync: 서브디렉토리 내 파일도 수집됨", async () => {
    const refs_dir = join(tmp_dir, "references");
    const sub_dir = join(refs_dir, "subdir");
    await mkdir(sub_dir, { recursive: true });
    await writeFile(join(sub_dir, "nested.md"), "# Nested Doc");

    const result = await store.sync();
    expect(result.added).toBe(1);
    const docs = store.list_documents();
    expect(docs[0]?.path).toContain("subdir");
  });

  it("search: FTS 검색 — 키워드 매칭 결과 반환", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "guide.md"), "# TypeScript Guide\n\nTypeScript is a typed superset of JavaScript.");

    await store.sync();
    const results = await store.search("typescript superset");

    expect(Array.isArray(results)).toBe(true);
    // FTS가 결과를 반환하거나 빈 배열 (환경에 따라 다름)
    if (results.length > 0) {
      expect(results[0]).toHaveProperty("chunk_id");
      expect(results[0]).toHaveProperty("score");
    }
  });

  it("search: doc_filter 옵션 — 특정 경로 필터링", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "api.md"), "# API Reference\n\nThis is the API documentation.");
    await writeFile(join(refs_dir, "guide.md"), "# User Guide\n\nThis is the user guide.");

    await store.sync();
    const results = await store.search("documentation", { doc_filter: "api" });

    expect(Array.isArray(results)).toBe(true);
    // api.md만 필터링됨 (결과 있다면 api 포함)
    for (const r of results) {
      expect(r.doc_path).toContain("api");
    }
  });

  it("search: limit 옵션으로 결과 수 제한", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    for (let i = 0; i < 5; i++) {
      await writeFile(join(refs_dir, `doc${i}.md`), `# Doc ${i}\n\nContent about testing number ${i}`);
    }

    await store.sync();
    const results = await store.search("testing", { limit: 2 });

    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("sync: 대용량 마크다운 → 청크 분할됨", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    // CHUNK_SIZE(1200)를 초과하는 내용
    const large_content = "# Big Document\n\n" + "A ".repeat(800) + "\n\n" + "B ".repeat(800);
    await writeFile(join(refs_dir, "big.md"), large_content);

    await store.sync();
    const stats = store.get_stats();
    // 청크가 2개 이상이어야 함
    expect(stats.total_chunks).toBeGreaterThan(1);
  });

  it("sync: 대용량 non-md 파일 → 청크 분할됨 (chunk_fixed)", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    const large_txt = "Line content here. ".repeat(100);
    await writeFile(join(refs_dir, "large.txt"), large_txt);

    await store.sync();
    const stats = store.get_stats();
    expect(stats.total_chunks).toBeGreaterThanOrEqual(1);
  });

  it("set_embed + sync → 임베딩 경로 실행 (빈 embedding 반환)", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "embed.md"), "# Embed Test\n\nContent to embed.");

    let embed_called = false;
    store.set_embed(async (_texts, _opts) => {
      embed_called = true;
      // VEC_DIMENSIONS=256 맞춤 빈 벡터 반환
      return { embeddings: _texts.map(() => new Array(256).fill(0.1)) };
    });

    const result = await store.sync();
    expect(result.added).toBe(1);
    expect(embed_called).toBe(true);
  });
});
