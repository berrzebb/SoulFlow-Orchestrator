/**
 * dashboard/ops/shared.ts + skill.ts — 미커버 분기 커버리지.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ──────────────────────────────────────────────────
// shared.ts 테스트
// ──────────────────────────────────────────────────

import {
  apply_connection_api_base,
  sanitize_rel_path,
  sanitize_filename,
  is_inside,
} from "@src/dashboard/ops/shared.js";

describe("shared — apply_connection_api_base", () => {
  const make_store = (resolved: string | null) => ({
    resolve_api_base: vi.fn().mockReturnValue(resolved),
    get: vi.fn(),
    set_token: vi.fn(),
    resolve_token: vi.fn(),
  } as any);

  it("resolved=null → config 그대로 반환", () => {
    const store = make_store(null);
    const config = { instance_id: "i1", settings: { api_base: "https://original.com" } } as any;
    const r = apply_connection_api_base(store, config);
    expect(r).toBe(config); // same reference
  });

  it("resolved === config.settings.api_base → config 그대로 반환", () => {
    const store = make_store("https://same.com");
    const config = { instance_id: "i1", settings: { api_base: "https://same.com" } } as any;
    const r = apply_connection_api_base(store, config);
    expect(r).toBe(config);
  });

  it("resolved 다름 → 새 config 반환 (api_base 업데이트)", () => {
    const store = make_store("https://new.com");
    const config = { instance_id: "i1", settings: { api_base: "https://old.com" } } as any;
    const r = apply_connection_api_base(store, config);
    expect(r).not.toBe(config);
    expect(r.settings.api_base).toBe("https://new.com");
  });
});

describe("shared — sanitize_rel_path", () => {
  it(".. 제거", () => {
    expect(sanitize_rel_path("../../etc/passwd")).toBe("etc/passwd");
  });

  it("선행 슬래시 제거", () => {
    expect(sanitize_rel_path("/foo/bar")).toBe("foo/bar");
  });

  it("백슬래시 선행 제거", () => {
    expect(sanitize_rel_path("\\foo")).toBe("foo");
  });

  it("정상 경로 → 그대로", () => {
    expect(sanitize_rel_path("skills/myfunc/SKILL.md")).toBe("skills/myfunc/SKILL.md");
  });
});

describe("shared — sanitize_filename", () => {
  it("슬래시 제거", () => {
    expect(sanitize_filename("path/to/file.md")).toBe("pathtofile.md");
  });

  it("백슬래시 제거", () => {
    expect(sanitize_filename("path\\file.md")).toBe("pathfile.md");
  });

  it(".. 제거", () => {
    expect(sanitize_filename("..secret.md")).toBe("secret.md");
  });

  it("정상 파일명 → 그대로", () => {
    expect(sanitize_filename("SKILL.md")).toBe("SKILL.md");
  });
});

describe("shared — is_inside", () => {
  it("동일 경로 → true", () => {
    const base = tmpdir();
    expect(is_inside(base, base)).toBe(true);
  });

  it("하위 경로 → true", () => {
    const base = tmpdir();
    expect(is_inside(base, join(base, "subdir", "file.txt"))).toBe(true);
  });

  it("상위 경로 → false", () => {
    const base = join(tmpdir(), "subdir");
    expect(is_inside(base, tmpdir())).toBe(false);
  });

  it("다른 경로 → false", () => {
    const base = join(tmpdir(), "a");
    const other = join(tmpdir(), "b");
    expect(is_inside(base, other)).toBe(false);
  });
});

// ──────────────────────────────────────────────────
// skill.ts 테스트
// ──────────────────────────────────────────────────

import { create_skill_ops } from "@src/dashboard/ops/skill.js";

let tmp_dir: string;

beforeEach(() => {
  tmp_dir = mkdtempSync(join(tmpdir(), "skill-test-"));
});

afterEach(() => {
  rmSync(tmp_dir, { recursive: true, force: true });
});

function make_loader(overrides: Partial<{
  skills: Array<Record<string, string>>;
  meta: Record<string, unknown> | null;
}> = {}) {
  const { skills = [], meta = null } = overrides;
  return {
    list_skills: vi.fn().mockReturnValue(skills),
    get_skill_metadata: vi.fn().mockReturnValue(meta),
    refresh: vi.fn(),
    suggest_skills_for_text: vi.fn().mockReturnValue([]),
  };
}

describe("create_skill_ops — list_skills", () => {
  it("skills_loader.list_skills() 결과 반환", () => {
    const loader = make_loader({ skills: [{ name: "foo" }] });
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp_dir });
    expect(ops.list_skills()).toEqual([{ name: "foo" }]);
  });
});

describe("create_skill_ops — get_skill_detail", () => {
  it("meta=null → content/references=null", () => {
    const loader = make_loader({ meta: null });
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp_dir });
    const r = ops.get_skill_detail("missing");
    expect(r.metadata).toBeNull();
    expect(r.content).toBeNull();
    expect(r.references).toBeNull();
  });

  it("meta.path 있고 파일 존재 → content 반환", () => {
    const skill_file = join(tmp_dir, "SKILL.md");
    writeFileSync(skill_file, "# My Skill");
    const loader = make_loader({ meta: { path: skill_file } });
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp_dir });
    const r = ops.get_skill_detail("foo");
    expect(r.content).toBe("# My Skill");
  });

  it("meta.path 있고 파일 없음 → content=null (catch skip)", () => {
    const loader = make_loader({ meta: { path: join(tmp_dir, "nonexistent.md") } });
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp_dir });
    const r = ops.get_skill_detail("foo");
    expect(r.content).toBeNull();
  });

  it("references 디렉터리 있음 → .md/.txt 파일 목록 반환", () => {
    const skill_file = join(tmp_dir, "SKILL.md");
    writeFileSync(skill_file, "content");
    const refs_dir = join(tmp_dir, "references");
    mkdirSync(refs_dir);
    writeFileSync(join(refs_dir, "guide.md"), "guide content");
    writeFileSync(join(refs_dir, "notes.txt"), "notes content");
    writeFileSync(join(refs_dir, "ignore.json"), "{}");

    const loader = make_loader({ meta: { path: skill_file } });
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp_dir });
    const r = ops.get_skill_detail("foo");
    expect(r.references).toHaveLength(2);
    expect(r.references!.map((ref) => ref.name).sort()).toEqual(["guide.md", "notes.txt"]);
  });
});

describe("create_skill_ops — refresh", () => {
  it("skills_loader.refresh() 호출", () => {
    const loader = make_loader();
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp_dir });
    ops.refresh();
    expect(loader.refresh).toHaveBeenCalledOnce();
  });
});

describe("create_skill_ops — write_skill_file", () => {
  it("meta=null → skill_not_found", () => {
    const loader = make_loader({ meta: null });
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp_dir });
    const r = ops.write_skill_file("foo", "SKILL.md", "content");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("skill_not_found");
  });

  it("source=builtin → builtin_readonly", () => {
    const skill_file = join(tmp_dir, "SKILL.md");
    writeFileSync(skill_file, "content");
    const loader = make_loader({ meta: { path: skill_file, source: "builtin" } });
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp_dir });
    const r = ops.write_skill_file("foo", "SKILL.md", "new");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("builtin_readonly");
  });

  it("source=BUILTIN (대소문자 무관) → builtin_readonly", () => {
    const skill_file = join(tmp_dir, "SKILL.md");
    writeFileSync(skill_file, "content");
    const loader = make_loader({ meta: { path: skill_file, source: "BUILTIN" } });
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp_dir });
    const r = ops.write_skill_file("foo", "SKILL.md", "new");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("builtin_readonly");
  });

  it("sanitize_filename 후 빈 문자열 → invalid_filename", () => {
    const skill_file = join(tmp_dir, "SKILL.md");
    writeFileSync(skill_file, "content");
    const loader = make_loader({ meta: { path: skill_file, source: "custom" } });
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp_dir });
    const r = ops.write_skill_file("foo", "../../../", "content");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("invalid_filename");
  });

  it("SKILL.md 파일 → meta.path에 직접 쓰기", () => {
    const skill_file = join(tmp_dir, "SKILL.md");
    writeFileSync(skill_file, "old");
    const loader = make_loader({ meta: { path: skill_file, source: "custom" } });
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp_dir });
    const r = ops.write_skill_file("foo", "SKILL.md", "new content");
    expect(r.ok).toBe(true);
    expect(readFileSync(skill_file, "utf-8")).toBe("new content");
    expect(loader.refresh).toHaveBeenCalledOnce();
  });

  it("references 파일 쓰기", () => {
    const skill_file = join(tmp_dir, "SKILL.md");
    writeFileSync(skill_file, "content");
    const refs_dir = join(tmp_dir, "references");
    mkdirSync(refs_dir, { recursive: true });
    const loader = make_loader({ meta: { path: skill_file, source: "custom" } });
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp_dir });
    const r = ops.write_skill_file("foo", "guide.md", "guide content");
    expect(r.ok).toBe(true);
    expect(readFileSync(join(refs_dir, "guide.md"), "utf-8")).toBe("guide content");
  });
});

describe("create_skill_ops — upload_skill", () => {
  it("adm-zip 없음 → ok=false, error 포함", () => {
    const loader = make_loader();
    const ops = create_skill_ops({ skills_loader: loader, workspace: tmp_dir });
    const r = ops.upload_skill("myskill", Buffer.from("not-a-zip"));
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});
