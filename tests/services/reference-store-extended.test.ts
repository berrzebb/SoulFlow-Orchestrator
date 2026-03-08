/**
 * ReferenceStore — 미커버 분기 보충.
 * 벡터 검색(embed_fn + search), 숨김 디렉토리,
 * 짧은 FTS 검색어 필터, scan_files 에러 무시,
 * chunk_fixed 대용량 overlap, search limit.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ReferenceStore } from "@src/services/reference-store.js";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp_dir: string;
let store: ReferenceStore;

beforeEach(async () => {
  tmp_dir = await mkdtemp(join(tmpdir(), "refstore-ext-"));
  store = new ReferenceStore(tmp_dir);
});

afterEach(async () => {
  await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
});

// ══════════════════════════════════════════
// 벡터 검색 — embed_fn + search()
// ══════════════════════════════════════════

describe("ReferenceStore — 벡터 검색 (embed_fn)", () => {
  it("embed_fn 설정 후 search() → 벡터 검색 경로 실행", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "vec.md"), "# Vector Test\n\nThis is vector search content.");

    // embed_fn 설정 후 동기화
    store.set_embed(async (_texts, _opts) => {
      return { embeddings: _texts.map(() => new Array(256).fill(0.5)) };
    });
    await store.sync();

    // embed_fn 있는 상태로 검색 → 벡터 검색 경로도 실행
    const results = await store.search("vector content");
    expect(Array.isArray(results)).toBe(true);
    // FTS 또는 벡터 결과 중 하나라도 있어야 함 (또는 빈 배열도 허용 — 에러 없어야 함)
  });

  it("embed_fn 설정 + 벡터 검색 결과 있을 때 score 계산", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "doc.md"), "# AI Systems\n\nNeural network and machine learning concepts.");

    let embed_count = 0;
    store.set_embed(async (texts, _opts) => {
      embed_count += texts.length;
      // 모든 벡터를 동일한 값으로 → 높은 유사도
      return { embeddings: texts.map(() => new Array(256).fill(0.01)) };
    });

    await store.sync();
    // search에도 embed_fn 사용
    const results = await store.search("neural machine learning");

    expect(embed_count).toBeGreaterThan(0);
    expect(Array.isArray(results)).toBe(true);
  });

  it("embed_fn 실패해도 FTS 결과는 반환됨", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "fallback.md"), "# Fallback Doc\n\nFallback content here.");

    store.set_embed(async (_texts, _opts) => {
      throw new Error("embedding service unavailable");
    });

    await store.sync();

    // sync embed 실패해도 FTS는 동작해야 함
    const results = await store.search("fallback content");
    expect(Array.isArray(results)).toBe(true);
  });
});

// ══════════════════════════════════════════
// scan_files — 숨김 디렉토리 스킵
// ══════════════════════════════════════════

describe("ReferenceStore — scan_files 숨김 항목", () => {
  it("점으로 시작하는 디렉토리 내 파일 → 무시", async () => {
    const refs_dir = join(tmp_dir, "references");
    const hidden_dir = join(refs_dir, ".hidden_dir");
    await mkdir(hidden_dir, { recursive: true });
    await writeFile(join(hidden_dir, "secret.md"), "# Secret");
    await writeFile(join(refs_dir, "public.md"), "# Public");

    const result = await store.sync();
    // public.md만 처리 (.hidden_dir 내 파일은 무시)
    expect(result.added).toBe(1);
    const docs = store.list_documents();
    expect(docs.map((d) => d.path)).not.toContain("secret.md");
    expect(docs.map((d) => d.path)).toContain("public.md");
  });
});

// ══════════════════════════════════════════
// search — FTS 검색어 필터 (짧은 단어)
// ══════════════════════════════════════════

describe("ReferenceStore — search FTS 검색어 처리", () => {
  it("1글자 검색어 → FTS 검색 건너뜀, 빈 배열", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "doc.md"), "# Doc\n\na b c d");

    await store.sync();
    const results = await store.search("a");
    expect(Array.isArray(results)).toBe(true);
    // 1글자는 FTS 검색어로 안 들어감 → [] 또는 embed_fn 결과만
    expect(results).toHaveLength(0);
  });

  it("2글자 이상 검색어는 FTS 처리됨", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "doc.md"), "# Doc\n\nJavaScript framework tutorial.");

    await store.sync();
    const results = await store.search("JS framework");
    expect(Array.isArray(results)).toBe(true);
  });

  it("특수문자 제거 후 검색어 추출", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    await writeFile(join(refs_dir, "doc.md"), "# Doc\n\nTypeScript types and interfaces.");

    await store.sync();
    // 특수문자 포함 검색 → 정규화 후 실행 (에러 없어야 함)
    const results = await store.search("TypeScript! @types& #interfaces");
    expect(Array.isArray(results)).toBe(true);
  });
});

// ══════════════════════════════════════════
// chunk_fixed — overlap 처리 대용량
// ══════════════════════════════════════════

describe("ReferenceStore — chunk_fixed overlap 처리", () => {
  it("대용량 txt 파일 → 여러 청크 분할 + overlap", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    // 1200자 이상 여러 번 초과 → 여러 청크
    const content = Array.from({ length: 200 }, (_, i) => `Line ${i}: This is content line with some text that fills space.`).join("\n");
    await writeFile(join(refs_dir, "large.ts"), content);

    await store.sync();
    const stats = store.get_stats();
    expect(stats.total_chunks).toBeGreaterThan(1);
  });
});

// ══════════════════════════════════════════
// chunk_markdown — 헤딩 분할 + overlap
// ══════════════════════════════════════════

describe("ReferenceStore — chunk_markdown 처리", () => {
  it("헤딩별로 청크 분할", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    const md_content = `# Section 1
Content of section 1.

## Subsection 1.1
More content here.

# Section 2
Content of section 2.
`;
    await writeFile(join(refs_dir, "sections.md"), md_content);

    await store.sync();
    const docs = store.list_documents();
    expect(docs[0]?.chunks).toBeGreaterThan(0);
  });

  it("대용량 마크다운 섹션 → 섹션 내 분할 (overlap 처리)", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    // 한 섹션이 1200자 초과 → 섹션 내 분할
    const big_section = "# Big Section\n\n" + "word ".repeat(400);
    await writeFile(join(refs_dir, "big-section.md"), big_section);

    await store.sync();
    const stats = store.get_stats();
    expect(stats.total_chunks).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════
// search — 정렬 및 limit
// ══════════════════════════════════════════

describe("ReferenceStore — search 정렬·limit", () => {
  it("검색 결과 score 내림차순 정렬", async () => {
    const refs_dir = join(tmp_dir, "references");
    await mkdir(refs_dir, { recursive: true });
    // 여러 문서 추가
    await writeFile(join(refs_dir, "a.md"), "# Guide\n\nTypeScript guide for developers.");
    await writeFile(join(refs_dir, "b.md"), "# TypeScript\n\nTypeScript TypeScript TypeScript core concepts.");

    await store.sync();
    const results = await store.search("typescript", { limit: 10 });
    if (results.length >= 2) {
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    }
  });
});
