/**
 * ReferenceStore — 미커버 분기 보충.
 * set_image_embed, sync 이미지 파일 처리, embed_image_chunks,
 * search image_embed_fn 경로, remove_document rows.length=0,
 * debounce 캐시 히트, sync 업데이트(is_new=false), list/stats 단독 테스트.
 */
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ReferenceStore } from "@src/services/reference-store.js";

let workspace: string;
let store: ReferenceStore;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "refstore-cov2-"));
  store = new ReferenceStore(workspace);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// ══════════════════════════════════════════
// set_image_embed — 메서드 직접 호출
// ══════════════════════════════════════════

describe("ReferenceStore — set_image_embed 메서드", () => {
  it("set_image_embed() 호출 → 에러 없음", () => {
    const fake_fn = vi.fn().mockResolvedValue({ embeddings: [[1, 2, 3]] });
    expect(() => store.set_image_embed(fake_fn as any)).not.toThrow();
  });
});

// ══════════════════════════════════════════
// sync — 이미지 파일 처리 (image_embed_fn 없음)
// ══════════════════════════════════════════

describe("ReferenceStore — sync 이미지 파일", () => {
  it("PNG 파일 추가 → added=1 (image 청크 생성)", async () => {
    const refs_dir = join(workspace, "references");
    await mkdir(refs_dir, { recursive: true });
    // 최소 PNG 바이트 (1x1 픽셀 PNG)
    const png_buf = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
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
    expect(result.updated).toBe(0);

    // list_documents에서 이미지 문서 확인
    const docs = store.list_documents();
    expect(docs.length).toBe(1);
    expect(docs[0].path).toBe("test.png");
  });

  it("JPEG 파일 추가 → added=1", async () => {
    const refs_dir = join(workspace, "references");
    await mkdir(refs_dir, { recursive: true });
    // 최소 JPEG 바이트
    const jpeg_buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
    await writeFile(join(refs_dir, "photo.jpg"), jpeg_buf);
    const result = await store.sync();
    expect(result.added).toBe(1);
  });

  it("JPEG .jpeg 확장자 → mime=image/jpeg 처리", async () => {
    const refs_dir = join(workspace, "references");
    await mkdir(refs_dir, { recursive: true });
    const jpeg_buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
    await writeFile(join(refs_dir, "photo.jpeg"), jpeg_buf);
    const result = await store.sync();
    expect(result.added).toBe(1);
  });

  it("GIF 파일 → added=1 (mime=image/gif)", async () => {
    const refs_dir = join(workspace, "references");
    await mkdir(refs_dir, { recursive: true });
    // 최소 GIF 바이트
    const gif_buf = Buffer.from("GIF89a");
    await writeFile(join(refs_dir, "anim.gif"), gif_buf);
    const result = await store.sync();
    expect(result.added).toBe(1);
  });

  it("WEBP 파일 → added=1 (mime=image/webp)", async () => {
    const refs_dir = join(workspace, "references");
    await mkdir(refs_dir, { recursive: true });
    // 최소 WEBP 시그니처
    const webp_buf = Buffer.from("RIFF0000WEBP");
    await writeFile(join(refs_dir, "image.webp"), webp_buf);
    const result = await store.sync();
    expect(result.added).toBe(1);
  });
});

// ══════════════════════════════════════════
// sync — 이미지 파일 + image_embed_fn 설정
// ══════════════════════════════════════════

describe("ReferenceStore — sync 이미지 파일 + image_embed_fn", () => {
  it("image_embed_fn 설정 → to_image_embed 경로 실행", async () => {
    const refs_dir = join(workspace, "references");
    await mkdir(refs_dir, { recursive: true });
    const png_buf = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    ]);
    await writeFile(join(refs_dir, "test.png"), png_buf);

    const image_embed_fn = vi.fn().mockResolvedValue({
      embeddings: [new Array(256).fill(0.1)],
    });
    store.set_image_embed(image_embed_fn as any);

    const result = await store.sync();
    expect(result.added).toBe(1);
    // image_embed_fn이 호출됨
    expect(image_embed_fn).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════
// sync — 업데이트 경로 (is_new=false)
// ══════════════════════════════════════════

describe("ReferenceStore — sync 파일 업데이트", () => {
  it("파일 내용 변경 → updated 카운트, removed=0", async () => {
    const refs_dir = join(workspace, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "doc.txt"), "original content");

    await store.sync();
    // last_sync 리셋 (debounce 우회)
    (store as any).last_sync = 0;

    await writeFile(join(refs_dir, "doc.txt"), "updated content here");
    const result2 = await store.sync();
    expect(result2.updated).toBe(1);
    expect(result2.removed).toBe(0);
    expect(result2.added).toBe(0);
  });
});

// ══════════════════════════════════════════
// sync — remove_document rows.length=0 경로
// ══════════════════════════════════════════

describe("ReferenceStore — sync 파일 삭제 (rows 없는 경우)", () => {
  it("파일 삭제 → removed=1 (벡터 행 없는 경우도 처리)", async () => {
    const refs_dir = join(workspace, "references");
    await mkdir(refs_dir, { recursive: true });
    const file_path = join(refs_dir, "temp.txt");
    await writeFile(file_path, "temp content");

    await store.sync();
    (store as any).last_sync = 0;

    // 파일 삭제
    const { unlink } = await import("node:fs/promises");
    await unlink(file_path);

    const result = await store.sync();
    expect(result.removed).toBe(1);
  });
});

// ══════════════════════════════════════════
// get_stats — last_sync 초기값
// ══════════════════════════════════════════

describe("ReferenceStore — get_stats 초기값 및 sync 후", () => {
  it("sync 전 → last_sync=null", () => {
    const stats = store.get_stats();
    expect(stats.last_sync).toBeNull();
    expect(stats.total_docs).toBe(0);
    expect(stats.total_chunks).toBe(0);
  });

  it("sync 후 → last_sync ISO 문자열 설정됨", async () => {
    const refs_dir = join(workspace, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "test.md"), "# Title\n\nContent");
    await store.sync();
    const stats = store.get_stats();
    expect(stats.last_sync).not.toBeNull();
    expect(stats.total_docs).toBe(1);
    expect(stats.total_chunks).toBeGreaterThanOrEqual(1);
  });
});

// ══════════════════════════════════════════
// search — image_embed_fn 경로
// ══════════════════════════════════════════

describe("ReferenceStore — search image_embed_fn 경로", () => {
  it("image_embed_fn 설정 → search 시 이미지 벡터 검색 경로 진입 (에러 없음)", async () => {
    const image_embed_fn = vi.fn().mockResolvedValue({ embeddings: [] });
    store.set_image_embed(image_embed_fn as any);

    const results = await store.search("test query");
    expect(Array.isArray(results)).toBe(true);
    // image_embed_fn 호출됨
    expect(image_embed_fn).toHaveBeenCalled();
  });

  it("image_embed_fn이 embeddings 반환 → KNN 검색 시도 (빈 결과)", async () => {
    const image_embed_fn = vi.fn().mockResolvedValue({
      embeddings: [new Array(256).fill(0.1)],
    });
    store.set_image_embed(image_embed_fn as any);

    const results = await store.search("test");
    expect(Array.isArray(results)).toBe(true);
  });
});

// ══════════════════════════════════════════
// search — doc_filter 경로 (ensure_init 히트)
// ══════════════════════════════════════════

describe("ReferenceStore — search 두 번 호출 (ensure_init 캐시)", () => {
  it("두 번 search → 두 번째는 initialized=true (캐시 히트)", async () => {
    const r1 = await store.search("query1");
    const r2 = await store.search("query2");
    expect(Array.isArray(r1)).toBe(true);
    expect(Array.isArray(r2)).toBe(true);
  });
});

// ══════════════════════════════════════════
// embed_fn 설정 + 실제 임베딩 데이터 반환
// ══════════════════════════════════════════

describe("ReferenceStore — embed_fn 실제 임베딩 반환", () => {
  it("embed_fn이 실제 벡터 반환 → 벡터 DB 저장 경로", async () => {
    const refs_dir = join(workspace, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "doc.md"), "# Test\n\nThis is test content for search.");

    const embed_fn = vi.fn().mockResolvedValue({
      embeddings: [new Array(256).fill(0.1)],
    });
    store.set_embed(embed_fn as any);
    const result = await store.sync();
    expect(result.added).toBe(1);
    expect(embed_fn).toHaveBeenCalled();
  });
});
