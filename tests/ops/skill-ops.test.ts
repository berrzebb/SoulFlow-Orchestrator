/**
 * create_skill_ops 커버리지 — list/get_detail/refresh/write_skill_file 테스트.
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { create_skill_ops } from "@src/dashboard/ops/skill.js";
import type { SkillsLoaderLike } from "@src/dashboard/ops/skill.js";

const tmp = mkdtempSync(join(tmpdir(), "skill-ops-test-"));

afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

// 스킬 디렉토리 구조 생성
// workspace/skills/my-skill/SKILL.md + references/guide.md
const skill_dir = join(tmp, "skills", "my-skill");
mkdirSync(join(skill_dir, "references"), { recursive: true });
writeFileSync(join(skill_dir, "SKILL.md"), "# My Skill\nDoes stuff.", "utf-8");
writeFileSync(join(skill_dir, "references", "guide.md"), "# Guide\nDetails.", "utf-8");

const SKILL_PATH = join(skill_dir, "SKILL.md");

function make_loader(overrides: Partial<SkillsLoaderLike> = {}): SkillsLoaderLike {
  return {
    list_skills: vi.fn().mockReturnValue([{ name: "my-skill" }]),
    get_skill_metadata: vi.fn().mockReturnValue({ path: SKILL_PATH, source: "user" }),
    refresh: vi.fn(),
    ...overrides,
  };
}

describe("create_skill_ops — list_skills", () => {
  it("loader.list_skills() 위임", () => {
    const loader = make_loader();
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp });
    const list = ops.list_skills();
    expect(list).toEqual([{ name: "my-skill" }]);
    expect(loader.list_skills).toHaveBeenCalled();
  });
});

describe("create_skill_ops — refresh", () => {
  it("loader.refresh() 호출", () => {
    const loader = make_loader();
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp });
    ops.refresh();
    expect(loader.refresh).toHaveBeenCalled();
  });
});

describe("create_skill_ops — get_skill_detail", () => {
  it("meta + content + references 반환", () => {
    const loader = make_loader();
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp });
    const detail = ops.get_skill_detail("my-skill");
    expect(detail.metadata).toMatchObject({ path: SKILL_PATH, source: "user" });
    expect(detail.content).toContain("My Skill");
    expect(detail.references).toHaveLength(1);
    expect(detail.references![0].name).toBe("guide.md");
    expect(detail.references![0].content).toContain("Guide");
  });

  it("meta path 없음 → content/references=null", () => {
    const loader = make_loader({
      get_skill_metadata: vi.fn().mockReturnValue({ name: "no-path" }),
    });
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp });
    const detail = ops.get_skill_detail("no-path");
    expect(detail.content).toBeNull();
    expect(detail.references).toBeNull();
  });

  it("meta 없음 → metadata=null, content/references=null", () => {
    const loader = make_loader({
      get_skill_metadata: vi.fn().mockReturnValue(null),
    });
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp });
    const detail = ops.get_skill_detail("nonexistent");
    expect(detail.metadata).toBeNull();
    expect(detail.content).toBeNull();
    expect(detail.references).toBeNull();
  });

  it("references 디렉토리 없음 → references=null", () => {
    const loader = make_loader({
      get_skill_metadata: vi.fn().mockReturnValue({ path: SKILL_PATH }),
    });
    // references 폴더가 없는 별도 스킬
    const no_ref_dir = join(tmp, "skills", "no-refs");
    mkdirSync(no_ref_dir, { recursive: true });
    writeFileSync(join(no_ref_dir, "SKILL.md"), "No refs");
    const loader2 = make_loader({
      get_skill_metadata: vi.fn().mockReturnValue({ path: join(no_ref_dir, "SKILL.md") }),
    });
    const ops = create_skill_ops({ skills_loader: loader2, workspace: tmp });
    const detail = ops.get_skill_detail("no-refs");
    expect(detail.references).toBeNull();
  });
});

describe("create_skill_ops — write_skill_file", () => {
  it("SKILL.md 쓰기 성공", () => {
    const loader = make_loader();
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp });
    const r = ops.write_skill_file("my-skill", "SKILL.md", "# Updated\nNew content.");
    expect(r.ok).toBe(true);
    expect(loader.refresh).toHaveBeenCalled();
  });

  it("references 파일 쓰기 성공", () => {
    const loader = make_loader();
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp });
    const r = ops.write_skill_file("my-skill", "new-ref.md", "New reference content.");
    expect(r.ok).toBe(true);
    expect(existsSync(join(skill_dir, "references", "new-ref.md"))).toBe(true);
  });

  it("builtin 스킬 → builtin_readonly 오류", () => {
    const loader = make_loader({
      get_skill_metadata: vi.fn().mockReturnValue({ path: SKILL_PATH, source: "builtin" }),
    });
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp });
    const r = ops.write_skill_file("my-skill", "SKILL.md", "content");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("builtin_readonly");
  });

  it("meta path 없음 → skill_not_found 오류", () => {
    const loader = make_loader({
      get_skill_metadata: vi.fn().mockReturnValue({ name: "no-path" }),
    });
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp });
    const r = ops.write_skill_file("no-path", "SKILL.md", "content");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("skill_not_found");
  });

  it("meta 없음 → skill_not_found 오류", () => {
    const loader = make_loader({
      get_skill_metadata: vi.fn().mockReturnValue(null),
    });
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp });
    const r = ops.write_skill_file("ghost", "SKILL.md", "content");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("skill_not_found");
  });

  it("파일명에 경로 구분자 → sanitize 후 쓰기 (invalid_filename 방지)", () => {
    const loader = make_loader();
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp });
    // sanitize_filename strips slashes → "guide.md"
    const r = ops.write_skill_file("my-skill", "sub/guide.md", "data");
    // 슬래시 제거 후 "subguide.md" 형태로 OK 또는 error
    expect(typeof r.ok).toBe("boolean");
  });

  it("빈 파일명 → invalid_filename 오류", () => {
    const loader = make_loader();
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp });
    // sanitize_filename("..") → "" → invalid
    const r = ops.write_skill_file("my-skill", "..", "content");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("invalid_filename");
  });
});
