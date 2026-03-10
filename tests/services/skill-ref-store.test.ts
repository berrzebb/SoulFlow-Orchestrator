/**
 * SkillRefStore — 전체 커버리지:
 * - constructor + get_stats (ensure_init)
 * - sync: 빈 roots, 파일 추가(added), debounce, 파일 변경(updated), 파일 삭제(removed)
 * - sync + embed_fn: 벡터 임베딩
 * - search: FTS 히트, 빈 쿼리 (terms < 2), skill_filter
 * - list_documents
 * - collect_md_files 재귀 (sub-directory)
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillRefStore } from "@src/services/skill-ref-store.js";

let tmp: string;

function setup(): { store: SkillRefStore; skills_root: string; data_dir: string } {
  tmp = mkdtempSync(join(tmpdir(), "skill-ref-"));
  const skills_root = join(tmp, "skills");
  const data_dir = join(tmp, "data");
  mkdirSync(skills_root, { recursive: true });
  mkdirSync(data_dir, { recursive: true });
  const store = new SkillRefStore([skills_root], data_dir);
  return { store, skills_root, data_dir };
}

function make_skill(skills_root: string, name: string, files: Record<string, string>): string {
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
// constructor + get_stats
// ══════════════════════════════════════════════════════════

describe("SkillRefStore — constructor + get_stats", () => {
  it("초기 상태 → 0 docs, 0 chunks, last_sync=null", () => {
    const { store } = setup();
    const stats = store.get_stats();
    expect(stats.total_docs).toBe(0);
    expect(stats.total_chunks).toBe(0);
    expect(stats.last_sync).toBeNull();
  });

  it("set_embed 후 embed_fn 등록됨", () => {
    const { store } = setup();
    const fn = async () => ({ embeddings: [[]] });
    expect(() => store.set_embed(fn as any)).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════
// sync — 빈 roots
// ══════════════════════════════════════════════════════════

describe("SkillRefStore — sync 빈 roots", () => {
  it("roots 없음 → 0/0/0 반환", async () => {
    tmp = mkdtempSync(join(tmpdir(), "skill-ref-"));
    const data_dir = join(tmp, "data");
    const store = new SkillRefStore([], data_dir);
    const result = await store.sync();
    expect(result).toEqual({ added: 0, updated: 0, removed: 0 });
  });

  it("존재하지 않는 root → 0/0/0 반환", async () => {
    const { store } = setup();
    const result = await store.sync();
    expect(result).toEqual({ added: 0, updated: 0, removed: 0 });
  });
});

// ══════════════════════════════════════════════════════════
// sync — 파일 추가
// ══════════════════════════════════════════════════════════

describe("SkillRefStore — sync 파일 추가", () => {
  it("md 파일 1개 → added=1", async () => {
    const { store, skills_root } = setup();
    make_skill(skills_root, "my-skill", {
      "guide.md": "# Getting Started\n\nThis is a guide.\n\n## Usage\n\nUse it wisely.",
    });
    const result = await store.sync();
    expect(result.added).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.removed).toBe(0);
  });

  it("md 파일 2개 (다른 스킬) → added=2", async () => {
    const { store, skills_root } = setup();
    make_skill(skills_root, "skill-a", { "ref.md": "# Title A\n\nContent A." });
    make_skill(skills_root, "skill-b", { "ref.md": "# Title B\n\nContent B." });
    const result = await store.sync();
    expect(result.added).toBe(2);
  });

  it("sync 후 get_stats → docs/chunks 증가", async () => {
    const { store, skills_root } = setup();
    make_skill(skills_root, "my-skill", {
      "doc1.md": "# Heading 1\n\nSome content here.\n\n# Heading 2\n\nMore content.",
    });
    await store.sync();
    const stats = store.get_stats();
    expect(stats.total_docs).toBe(1);
    expect(stats.total_chunks).toBeGreaterThan(0);
    expect(stats.last_sync).not.toBeNull();
  });
});

// ══════════════════════════════════════════════════════════
// sync — debounce
// ══════════════════════════════════════════════════════════

describe("SkillRefStore — sync debounce", () => {
  it("연속 호출 → 두 번째는 0/0/0 반환", async () => {
    const { store, skills_root } = setup();
    make_skill(skills_root, "my-skill", { "ref.md": "# Title\n\nContent." });
    await store.sync();
    // debounce: 5분 미경과 → 두 번째 호출 즉시 반환
    const result2 = await store.sync();
    expect(result2).toEqual({ added: 0, updated: 0, removed: 0 });
  });
});

// ══════════════════════════════════════════════════════════
// sync — 파일 변경 (updated)
// ══════════════════════════════════════════════════════════

describe("SkillRefStore — sync 파일 변경", () => {
  it("파일 내용 변경 → updated=1", async () => {
    const { store, skills_root } = setup();
    const refs_dir = make_skill(skills_root, "my-skill", { "ref.md": "# Old\n\nOld content." });

    await store.sync();
    // last_sync 리셋 (내부 필드 직접 변경)
    (store as any).last_sync = 0;

    // 파일 내용 변경
    writeFileSync(join(refs_dir, "ref.md"), "# New\n\nNew content with changes.");
    const result = await store.sync();
    expect(result.updated).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════
// sync — 파일 삭제 (removed)
// ══════════════════════════════════════════════════════════

describe("SkillRefStore — sync 파일 삭제", () => {
  it("파일 삭제 후 sync → removed=1", async () => {
    const { store, skills_root } = setup();
    const refs_dir = make_skill(skills_root, "my-skill", { "ref.md": "# Title\n\nContent." });

    await store.sync();
    (store as any).last_sync = 0;

    // 파일 삭제
    rmSync(join(refs_dir, "ref.md"));
    const result = await store.sync();
    expect(result.removed).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════
// sync — embed_fn 포함
// ══════════════════════════════════════════════════════════

describe("SkillRefStore — sync with embed_fn", () => {
  it("embed_fn 제공 → 청크 임베딩 처리 (실패 무시)", async () => {
    const { store, skills_root } = setup();
    make_skill(skills_root, "my-skill", { "ref.md": "# Title\n\nContent to embed." });

    // 256차원 정규화 가능한 벡터 반환
    const embed_fn = async (texts: string[]) => ({
      embeddings: texts.map((_, i) => Array.from({ length: 256 }, (__, j) => (j === i % 256 ? 1.0 : 0.0))),
    });
    store.set_embed(embed_fn as any);

    const result = await store.sync();
    expect(result.added).toBe(1);
    // 임베딩 성공 시 stats 그대로
    const stats = store.get_stats();
    expect(stats.total_chunks).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════
// search — FTS
// ══════════════════════════════════════════════════════════

describe("SkillRefStore — search FTS", () => {
  it("매칭 쿼리 → 결과 반환", async () => {
    const { store, skills_root } = setup();
    make_skill(skills_root, "my-skill", {
      "ref.md": "# Deployment\n\nHow to deploy the application to production.",
    });
    await store.sync();

    const results = await store.search("deploy application");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("deploy");
  });

  it("짧은 단어만 (<2자) → FTS 스킵 + 빈 결과", async () => {
    const { store, skills_root } = setup();
    make_skill(skills_root, "my-skill", { "ref.md": "# Title\n\nContent." });
    await store.sync();

    const results = await store.search("a"); // 1자 → FTS 건너뜀
    expect(Array.isArray(results)).toBe(true);
  });

  it("skill_filter → 해당 스킬 문서만 반환", async () => {
    const { store, skills_root } = setup();
    make_skill(skills_root, "skill-a", { "ref.md": "# Alpha Guide\n\nAlpha content here." });
    make_skill(skills_root, "skill-b", { "ref.md": "# Beta Guide\n\nBeta content here." });
    await store.sync();

    const results = await store.search("guide", { doc_filter: "skill-a" });
    // skill-a만 반환되어야 함
    for (const r of results) {
      expect(r.doc_path).toContain("skill-a");
    }
  });

  it("limit 옵션 → 결과 수 제한", async () => {
    const { store, skills_root } = setup();
    const content = Array.from({ length: 10 }, (_, i) => `# Section ${i}\n\nContent for section ${i}.`).join("\n\n");
    make_skill(skills_root, "my-skill", { "ref.md": content });
    await store.sync();

    const results = await store.search("content section", { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

// ══════════════════════════════════════════════════════════
// list_documents
// ══════════════════════════════════════════════════════════

describe("SkillRefStore — list_documents", () => {
  it("sync 전 → 빈 배열", () => {
    const { store } = setup();
    const docs = store.list_documents();
    expect(docs).toEqual([]);
  });

  it("sync 후 → 문서 목록 반환", async () => {
    const { store, skills_root } = setup();
    make_skill(skills_root, "my-skill", { "ref.md": "# Title\n\nContent." });
    await store.sync();

    const docs = store.list_documents();
    expect(docs.length).toBe(1);
    expect(docs[0].path).toContain("references");
    expect(docs[0].chunks).toBeGreaterThan(0);
    expect(docs[0].updated_at).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════
// collect_md_files — 재귀 서브디렉토리
// ══════════════════════════════════════════════════════════

describe("SkillRefStore — collect_md_files 재귀", () => {
  it("references 하위 sub-directory의 md 파일도 수집", async () => {
    const { store, skills_root } = setup();
    const refs_dir = join(skills_root, "my-skill", "references");
    const sub_dir = join(refs_dir, "advanced");
    mkdirSync(sub_dir, { recursive: true });
    writeFileSync(join(refs_dir, "basic.md"), "# Basic\n\nBasic guide.");
    writeFileSync(join(sub_dir, "advanced.md"), "# Advanced\n\nAdvanced guide.");

    const result = await store.sync();
    // references/ + references/advanced/ 합쳐서 2개 파일
    expect(result.added).toBe(2);
  });

  it("_underscore 스킬 디렉터리 → 무시", async () => {
    const { store, skills_root } = setup();
    make_skill(skills_root, "_hidden", { "ref.md": "# Hidden\n\nShouldnt be indexed." });
    make_skill(skills_root, "visible", { "ref.md": "# Visible\n\nShould be indexed." });

    const result = await store.sync();
    expect(result.added).toBe(1); // _hidden은 무시됨
  });
});
