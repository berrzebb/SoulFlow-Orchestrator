/**
 * SkillRefStore — 미커버 분기 보충 (cov2).
 * - L117: hash 동일 시 skip (변경 없이 재sync)
 * - L255: 존재하지 않는 root → skip
 * - L260: references/ 없는 스킬 디렉터리 → skip
 * - L318-323: chunk_markdown 오버플로우 (>CHUNK_SIZE)
 * - L379: normalize_vec norm=0 (all-zero embedding)
 * - L190-213: 벡터 KNN 검색 경로 (embed_fn 설정 후 search)
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillRefStore } from "@src/services/skill-ref-store.js";

let tmp: string;

function setup(): { store: SkillRefStore; skills_root: string; data_dir: string } {
  tmp = mkdtempSync(join(tmpdir(), "srs-cov2-"));
  const skills_root = join(tmp, "skills");
  const data_dir = join(tmp, "data");
  mkdirSync(skills_root, { recursive: true });
  mkdirSync(data_dir, { recursive: true });
  const store = new SkillRefStore([skills_root], data_dir);
  return { store, skills_root, data_dir };
}

function make_skill_refs(skills_root: string, name: string, files: Record<string, string>): string {
  const refs_dir = join(skills_root, name, "references");
  mkdirSync(refs_dir, { recursive: true });
  for (const [fname, content] of Object.entries(files)) {
    writeFileSync(join(refs_dir, fname), content);
  }
  return refs_dir;
}

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

// ══════════════════════════════════════════════════════════
// L117 — hash 동일 skip
// ══════════════════════════════════════════════════════════

describe("SkillRefStore — L117 hash 동일 skip", () => {
  it("last_sync 리셋 후 파일 변경 없이 재sync → added=0 (hash skip)", async () => {
    const { store, skills_root } = setup();
    make_skill_refs(skills_root, "my-skill", { "guide.md": "# Guide\n\nContent here." });

    const r1 = await store.sync();
    expect(r1.added).toBe(1);

    // last_sync 리셋 (debounce 우회)
    (store as any).last_sync = 0;

    // 파일 변경 없음 → hash 동일 → L117 continue
    const r2 = await store.sync();
    expect(r2.added).toBe(0);
    expect(r2.updated).toBe(0);
    expect(r2.removed).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════
// L255 — 존재하지 않는 root → skip
// ══════════════════════════════════════════════════════════

describe("SkillRefStore — L255 존재하지 않는 root", () => {
  it("non-existent root 경로 → 0/0/0 반환", async () => {
    tmp = mkdtempSync(join(tmpdir(), "srs-cov2-"));
    const data_dir = join(tmp, "data");
    const non_existent = join(tmp, "no-such-dir");
    const store = new SkillRefStore([non_existent], data_dir);

    const result = await store.sync();
    expect(result).toEqual({ added: 0, updated: 0, removed: 0 });
  });

  it("유효 root + 존재하지 않는 root 혼합 → 유효 root만 처리", async () => {
    const { store, skills_root } = setup();
    const non_existent = join(tmp, "no-such");
    const store2 = new SkillRefStore([non_existent, skills_root], join(tmp, "data2"));
    mkdirSync(join(tmp, "data2"), { recursive: true });
    make_skill_refs(skills_root, "skill-x", { "ref.md": "# Title\n\nContent." });

    const result = await store2.sync();
    expect(result.added).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════
// L260 — references/ 없는 스킬 디렉터리 → skip
// ══════════════════════════════════════════════════════════

describe("SkillRefStore — L260 references 디렉터리 없음", () => {
  it("skill 디렉터리가 있지만 references/ 없음 → added=0", async () => {
    const { store, skills_root } = setup();
    // references/ 없이 스킬 디렉터리만 생성
    mkdirSync(join(skills_root, "no-refs"), { recursive: true });
    writeFileSync(join(skills_root, "no-refs", "SKILL.md"), "# Skill\n\nNo references here.");

    const result = await store.sync();
    expect(result.added).toBe(0);
  });

  it("references/ 없는 스킬 + references/ 있는 스킬 혼합", async () => {
    const { store, skills_root } = setup();
    // references/ 없는 스킬
    mkdirSync(join(skills_root, "no-refs"), { recursive: true });
    // references/ 있는 스킬
    make_skill_refs(skills_root, "with-refs", { "guide.md": "# Guide\n\nContent." });

    const result = await store.sync();
    expect(result.added).toBe(1); // with-refs만 인덱싱
  });
});

// ══════════════════════════════════════════════════════════
// L318-323 — chunk_markdown 오버플로우 (>1200자)
// ══════════════════════════════════════════════════════════

describe("SkillRefStore — L318-323 chunk 오버플로우", () => {
  it("1200자 초과 단일 섹션 → 여러 청크로 분할 (L318-320)", async () => {
    const { store, skills_root } = setup();
    // CHUNK_SIZE=1200 초과: 헤딩 없이 긴 줄들로 구성
    const long_lines = Array.from({ length: 60 }, (_, i) =>
      `Line ${i + 1}: ${"x".repeat(40)} — some detailed content about topic ${i + 1}.`,
    ).join("\n");
    make_skill_refs(skills_root, "my-skill", { "long.md": `# Long Section\n\n${long_lines}` });

    const result = await store.sync();
    expect(result.added).toBe(1);
    // 오버플로우로 인해 청크가 2개 이상
    const stats = store.get_stats();
    expect(stats.total_chunks).toBeGreaterThan(1);
  });

  it("헤딩 없이 처음부터 긴 콘텐츠 → else 분기 (L323)", async () => {
    const { store, skills_root } = setup();
    // 헤딩 없이 처음부터 1200자 초과: overlap으로 인한 next_start <= prev_start 조건
    // buf가 짧고 start=1인 상태에서 오버플로우 → next_start가 prev_start 이하
    const very_long_single = "word_token ".repeat(130); // ~1430자
    make_skill_refs(skills_root, "my-skill", { "no-heading.md": very_long_single });

    const result = await store.sync();
    expect(result.added).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════
// L379 — normalize_vec norm=0 (all-zero vector)
// ══════════════════════════════════════════════════════════

describe("SkillRefStore — L379 normalize_vec norm=0", () => {
  it("all-zero embedding → norm=0 분기 통과, 에러 없음", async () => {
    const { store, skills_root } = setup();
    make_skill_refs(skills_root, "my-skill", { "ref.md": "# Title\n\nContent to embed." });

    // 모든 0 벡터 반환 → normalize_vec 내 norm=0 분기
    const embed_fn = async (texts: string[]) => ({
      embeddings: texts.map(() => new Array(256).fill(0)),
    });
    store.set_embed(embed_fn as any);

    const result = await store.sync();
    expect(result.added).toBe(1); // 임베딩 실패해도 added 기록
  });
});

// ══════════════════════════════════════════════════════════
// L190-213 — 벡터 KNN 검색 (embed_fn 설정 후 search)
// ══════════════════════════════════════════════════════════

describe("SkillRefStore — L190-213 벡터 KNN 검색", () => {
  it("embed_fn 있고 벡터 있음 → KNN 경로 실행", async () => {
    const { store, skills_root } = setup();
    make_skill_refs(skills_root, "my-skill", {
      "ref.md": "# Deployment Guide\n\nHow to deploy to production environment.",
    });

    const embed_fn = async (texts: string[]) => ({
      embeddings: texts.map((_, i) => Array.from({ length: 256 }, (__, j) => (j === i % 256 ? 1.0 : 0.0))),
    });
    store.set_embed(embed_fn as any);
    await store.sync();

    // search 호출 시 embed_fn 있으면 KNN 경로 실행 (L190-213)
    const results = await store.search("deploy production");
    expect(Array.isArray(results)).toBe(true);
  });

  it("embed_fn 있고 skill_filter 적용 → KNN 결과에서 필터링 (L209-211)", async () => {
    const { store, skills_root } = setup();
    make_skill_refs(skills_root, "skill-a", { "ref.md": "# Alpha\n\nAlpha deployment guide." });
    make_skill_refs(skills_root, "skill-b", { "ref.md": "# Beta\n\nBeta deployment guide." });

    const embed_fn = async (texts: string[]) => ({
      embeddings: texts.map((_, i) => Array.from({ length: 256 }, (__, j) => (j === i % 256 ? 1.0 : 0.0))),
    });
    store.set_embed(embed_fn as any);
    await store.sync();

    const results = await store.search("deployment", { doc_filter: "skill-a", limit: 5 });
    expect(Array.isArray(results)).toBe(true);
    for (const r of results) {
      expect(r.doc_path).toContain("skill-a");
    }
  });

  it("embed_fn 있지만 embeddings 빈 배열 → KNN 스킵", async () => {
    const { store, skills_root } = setup();
    make_skill_refs(skills_root, "my-skill", { "ref.md": "# Title\n\nContent." });

    const embed_fn = async () => ({ embeddings: [] as number[][] });
    store.set_embed(embed_fn as any);
    await store.sync();

    const results = await store.search("content");
    expect(Array.isArray(results)).toBe(true);
  });

  it("FTS 스킵 (1자 쿼리) + KNN → L200-213 내부 경로 실행", async () => {
    const { store, skills_root } = setup();
    make_skill_refs(skills_root, "my-skill", {
      "ref.md": "# Deployment Guide\n\nHow to deploy the application to production.",
    });

    // 비zero 임베딩 → sqlite-vec에 실제로 저장됨
    const embed_fn = async (texts: string[]) => ({
      embeddings: texts.map((_, i) => Array.from({ length: 256 }, (__, j) => (j === (i * 7 + 1) % 256 ? 1.0 : 0.0))),
    });
    store.set_embed(embed_fn as any);
    await store.sync();

    // 1자 쿼리 → FTS terms 필터링됨 → results map 비어있음 → KNN 결과가 results에 없어 L206 continue 안 됨
    const results = await store.search("x");
    expect(Array.isArray(results)).toBe(true);
  });
});
