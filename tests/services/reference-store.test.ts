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
});
