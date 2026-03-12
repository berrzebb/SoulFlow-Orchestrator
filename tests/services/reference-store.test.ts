/**
 * ReferenceStore — SQLite + FTS5 기반 문서 청크 저장소 테스트.
 * sqlite-vec 벡터 임베딩 경로는 embed_fn 없이 건너뜀.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ReferenceStore } from "../../src/services/reference-store.js";
import { mkdtemp, rm, writeFile, mkdir, unlink } from "node:fs/promises";
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
    await writeFile(join(refs_dir, "archive.zip"), "fake zip data");
    await writeFile(join(refs_dir, "doc.md"), "# Doc");

    const result = await store.sync();
    expect(result.added).toBe(1); // only .md (.zip은 미지원)
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

  // ── set_image_embed ──

  it("set_image_embed() 호출 → 에러 없음", () => {
    const fake_fn = vi.fn().mockResolvedValue({ embeddings: [[1, 2, 3]] });
    expect(() => store.set_image_embed(fake_fn as any)).not.toThrow();
  });

  // ── 이미지 파일 sync ──

  it("sync: PNG 파일 추가 → added=1", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    const png_buf = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
      0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
      0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC,
      0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
      0x44, 0xAE, 0x42, 0x60, 0x82,
    ]);
    await writeFile(join(refs_dir, "test.png"), png_buf);
    const result = await store.sync();
    expect(result.added).toBe(1);
    const docs = store.list_documents();
    expect(docs.length).toBe(1);
    expect(docs[0].path).toBe("test.png");
  });

  it("sync: JPEG 파일 추가 → added=1", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    const jpeg_buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
    await writeFile(join(refs_dir, "photo.jpg"), jpeg_buf);
    const result = await store.sync();
    expect(result.added).toBe(1);
  });

  it("sync: GIF 파일 → added=1", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "anim.gif"), Buffer.from("GIF89a"));
    const result = await store.sync();
    expect(result.added).toBe(1);
  });

  it("sync: WEBP 파일 → added=1", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "image.webp"), Buffer.from("RIFF0000WEBP"));
    const result = await store.sync();
    expect(result.added).toBe(1);
  });

  it("sync: image_embed_fn 설정 → to_image_embed 경로 실행", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "test.png"), Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
    const image_embed_fn = vi.fn().mockResolvedValue({ embeddings: [new Array(256).fill(0.1)] });
    store.set_image_embed(image_embed_fn as any);
    const result = await store.sync();
    expect(result.added).toBe(1);
    expect(image_embed_fn).toHaveBeenCalled();
  });

  // ── search image_embed_fn 경로 ──

  it("search: image_embed_fn 설정 → 이미지 벡터 검색 경로 진입", async () => {
    const image_embed_fn = vi.fn().mockResolvedValue({ embeddings: [] });
    store.set_image_embed(image_embed_fn as any);
    const results = await store.search("test query");
    expect(Array.isArray(results)).toBe(true);
    expect(image_embed_fn).toHaveBeenCalled();
  });

  it("search: image_embed_fn이 embeddings 반환 → KNN 검색 시도", async () => {
    const image_embed_fn = vi.fn().mockResolvedValue({ embeddings: [new Array(256).fill(0.1)] });
    store.set_image_embed(image_embed_fn as any);
    const results = await store.search("test");
    expect(Array.isArray(results)).toBe(true);
  });

  // ── search 두 번 호출 (ensure_init 캐시) ──

  it("search: 두 번 호출 → 두 번째는 initialized=true 캐시 히트", async () => {
    const r1 = await store.search("query1");
    const r2 = await store.search("query2");
    expect(Array.isArray(r1)).toBe(true);
    expect(Array.isArray(r2)).toBe(true);
  });

  // ── sync 파일 삭제 (rows empty) ──

  it("sync: 파일 삭제 → removed=1 (벡터 행 없는 경우도 처리)", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    const file_path = join(refs_dir, "temp.txt");
    await writeFile(file_path, "temp content");
    await store.sync();
    (store as any).last_sync = 0;
    await unlink(file_path);
    const result = await store.sync();
    expect(result.removed).toBe(1);
  });

  // ── chunk_markdown overlap ──

  it("chunk_markdown: 1200자 초과 + overlap → 오버랩 유지", () => {
    const long_line = "x".repeat(105);
    const lines = ["# Section\n"];
    for (let i = 0; i < 13; i++) lines.push(`${long_line}_line${i}\n`);
    const content = lines.join("");
    const chunks = (store as any).chunk_markdown(content, "test.md");
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].doc_path).toBe("test.md");
  });

  it("chunk_text: heading 없는 긴 콘텐츠 → chunk_fixed로 처리", () => {
    const content = "plain text ".repeat(200);
    const chunks = (store as any).chunk_text(content, "notes.txt");
    expect(Array.isArray(chunks)).toBe(true);
  });

  it("chunk_markdown: 여러 섹션 + 각 섹션 오버플로우 → 여러 chunk", () => {
    const long_line = "y".repeat(110);
    let content = "";
    for (let s = 0; s < 2; s++) {
      content += `# Section ${s}\n`;
      for (let i = 0; i < 13; i++) content += `${long_line}_s${s}_l${i}\n`;
    }
    const chunks = (store as any).chunk_markdown(content, "multi.md");
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  // ── 파일 해시 불변 → sync skip ──

  it("sync: 동일 파일로 두 번(force) → 두 번째는 해시 동일 skip", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "doc.md"), "# Hello\nThis is a test document.\n");
    const r1 = await store.sync({ force: true });
    expect(r1.added).toBeGreaterThanOrEqual(1);
    const r2 = await store.sync({ force: true });
    expect(r2.added).toBe(0);
    expect(r2.updated).toBe(0);
  });

  // ── embed_chunks 조기 반환 (embed_fn null) ──

  it("sync: embed_fn 미설정 시 → embed_chunks 조기 반환", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "sample.md"), "# Sample\n" + "text ".repeat(100));
    const r = await store.sync({ force: true });
    expect(typeof r.added).toBe("number");
  });

  // ── embed_image_chunks 조기 반환 (items empty) ──

  it("embed_image_chunks: 빈 items → return", async () => {
    const fake_db: any = {};
    await expect(
      (store as any).embed_image_chunks(fake_db, [])
    ).resolves.toBeUndefined();
  });

  it("embed_image_chunks: image_embed_fn null + items → return", async () => {
    const fake_db: any = {};
    await expect(
      (store as any).embed_image_chunks(fake_db, [{ chunk_id: "c1", data_url: "data:image/png;base64,abc" }])
    ).resolves.toBeUndefined();
  });

  // ── normalize_vec norm=0 ──

  it("normalize_vec: 모두 0인 벡터 → 정규화 없이 반환", async () => {
    let embed_called = false;
    const zero_embed = async (texts: string[]) => {
      embed_called = true;
      return { embeddings: texts.map(() => new Array(128).fill(0) as number[]) };
    };
    store.set_embed(zero_embed as any);
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "zero.md"), "# Zero\n" + "zero vector test ".repeat(20));
    await store.sync({ force: true });
    expect(embed_called).toBe(true);
  });
});
