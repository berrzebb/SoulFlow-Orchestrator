/**
 * SkillsLoader — 미커버 분기 (cov4):
 * - L87: _resolve_skill_name — case-insensitive 루프 매칭
 * - L228: _scan_flat_md — .md 아닌 파일 → skip
 * - L230: _scan_flat_md — .md 이름이지만 디렉토리 → skip
 * - L235: _scan_flat_md — 중복 이름 → skip
 * - L354: suggest_skills_for_text — 다른 점수 정렬 (b.score !== a.score)
 * - L400: _parse_metadata — 프론트매터 빈 줄 → continue
 * - L454: load_role_context — body strips to empty → null 반환
 * - L480: register_alias — 빈 alias → return
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SkillsLoader } from "@src/agent/skills.service.js";
import type { SkillMetadata } from "@src/agent/skills.types.js";

const tmp_dirs: string[] = [];

afterEach(() => {
  for (const d of tmp_dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function make_workspace(): string {
  const d = mkdtempSync(join(tmpdir(), "skills-cov4-"));
  tmp_dirs.push(d);
  return d;
}

function make_loader(workspace: string): SkillsLoader {
  return new SkillsLoader(workspace, workspace);
}

function make_meta(name: string, overrides: Partial<SkillMetadata> = {}): SkillMetadata {
  return {
    name,
    path: `/fake/${name}`,
    source: "workspace_skills",
    type: "tool",
    always: false,
    summary: "",
    aliases: [],
    triggers: [],
    tools: [],
    requirements: [],
    model: null,
    frontmatter: {},
    role: null,
    soul: null,
    heart: null,
    shared_protocols: [],
    preferred_providers: [],
    oauth: [],
    intents: [],
    file_patterns: [],
    code_patterns: [],
    checks: [],
    project_docs: false,
    ...overrides,
  };
}

// ── L87: _resolve_skill_name — case-insensitive 루프 매칭 ────────────────────

describe("SkillsLoader._resolve_skill_name — L87: case-insensitive 루프", () => {
  it("alias 미등록 + merged에 다른 케이스 이름 → L87 루프 매칭", () => {
    const ws = make_workspace();
    const loader = make_loader(ws);

    // merged에 직접 주입 (alias 없이)
    const meta = make_meta("SpecialSkill");
    (loader as any).merged.set("SpecialSkill", meta);
    // alias_to_name에 등록하지 않아 alias 조회 실패

    // "specialskill" → merged.has=false, alias 없음 → L87 루프에서 "SpecialSkill" 발견
    const resolved = (loader as any)._resolve_skill_name("specialskill");
    expect(resolved).toBe("SpecialSkill");
  });
});

// ── L228, L230, L235: _scan_flat_md 분기 ────────────────────────────────────

describe("SkillsLoader._scan_flat_md — 파일 필터링 분기", () => {
  it("commands 디렉토리에 .md 아닌 파일 → L228 skip", () => {
    const ws = make_workspace();
    const commands = join(ws, ".claude", "commands");
    mkdirSync(commands, { recursive: true });

    // .md 아닌 파일 — L228: if (!filename.endsWith(".md")) continue
    writeFileSync(join(commands, "readme.txt"), "text");
    writeFileSync(join(commands, "config.json"), "{}");

    // 에러 없이 로드 (비-.md 파일은 무시됨)
    const loader = make_loader(ws);
    expect(loader.list_skills().length).toBe(0);
  });

  it("commands 디렉토리에 .md 이름 디렉토리 → L230 skip", () => {
    const ws = make_workspace();
    const commands = join(ws, ".claude", "commands");
    mkdirSync(commands, { recursive: true });

    // .md 이름이지만 디렉토리 — L230: if (!statSync(filePath).isFile()) continue
    mkdirSync(join(commands, "subdir.md"), { recursive: true });

    const loader = make_loader(ws);
    expect(loader.list_skills().length).toBe(0);
  });

  it("같은 이름의 .md 파일 두 개 → L235 두 번째 skip", () => {
    const ws = make_workspace();
    const commands = join(ws, ".claude", "commands");
    mkdirSync(commands, { recursive: true });

    // 두 파일 모두 name: "duplicate" → 두 번째는 L235 skip
    writeFileSync(
      join(commands, "skill1.md"),
      "---\nname: duplicate\n---\nFirst body",
    );
    writeFileSync(
      join(commands, "skill2.md"),
      "---\nname: duplicate\n---\nSecond body (skipped)",
    );

    const loader = make_loader(ws);
    // 첫 번째만 로드됨
    const skills = loader.list_skills();
    const dup_count = skills.filter((s) => s.name === "duplicate").length;
    expect(dup_count).toBe(1);
  });
});

// ── L354: suggest_skills_for_text — 다른 점수 정렬 ──────────────────────────

describe("SkillsLoader.suggest_skills_for_text — L354: 다른 점수 정렬", () => {
  it("스킬 A 이름 매칭(+6) vs 스킬 B 트리거 매칭(+5) → L354 다른 점수 비교", () => {
    const ws = make_workspace();
    const loader = make_loader(ws);

    // 스킬 A: 이름이 쿼리에 포함 (이름=단어 단위) → score=6
    // normalize_text_for_match("alpha") = " alpha "
    (loader as any).merged.set("alpha", make_meta("alpha", {
      summary: "general purpose",
      triggers: [],
      aliases: [],
    }));
    // 스킬 B: 트리거가 쿼리에 포함 → score=5
    (loader as any).merged.set("omega", make_meta("omega", {
      summary: "general purpose",
      triggers: ["beta"],
      aliases: [],
    }));

    // 쿼리: "alpha beta task" → alpha 이름 매칭(+6), omega 트리거(beta) 매칭(+5)
    const result = loader.suggest_skills_for_text("alpha beta task", 10);
    // 두 스킬 모두 점수 있음, 점수 다름 → L354: b.score !== a.score → return
    expect(result.length).toBeGreaterThanOrEqual(2);
    // alpha가 앞에 와야 함 (점수 6 > 5)
    const idx_alpha = result.indexOf("alpha");
    const idx_omega = result.indexOf("omega");
    expect(idx_alpha).toBeGreaterThanOrEqual(0);
    expect(idx_omega).toBeGreaterThanOrEqual(0);
    expect(idx_alpha).toBeLessThan(idx_omega);
  });
});

// ── L400: _parse_metadata — 빈 줄 → continue ────────────────────────────────

describe("SkillsLoader._parse_metadata — L400: 프론트매터 빈 줄", () => {
  it("프론트매터에 빈 줄 포함 → L400 continue, 나머지 정상 파싱", () => {
    const ws = make_workspace();
    const commands = join(ws, ".claude", "commands");
    mkdirSync(commands, { recursive: true });

    // 프론트매터에 빈 줄 포함
    writeFileSync(
      join(commands, "blank_line_skill.md"),
      "---\nname: blank-line-skill\n\ndescription: after blank line\n---\nSkill body here.",
    );

    const loader = make_loader(ws);
    const meta = loader.get_skill_metadata("blank-line-skill");
    expect(meta).not.toBeNull();
    expect(meta?.name).toBe("blank-line-skill");
  });
});

// ── L454: load_role_context — body 빈 문자열 → null 반환 ────────────────────

describe("SkillsLoader.load_role_context — L454: body 빈 → null", () => {
  it("역할 스킬 body가 비어있으면 L454 → null 반환", () => {
    const ws = make_workspace();
    const loader = make_loader(ws);

    // 역할 스킬을 직접 주입 (body 없음)
    const meta = make_meta("empty-role", {
      type: "role",
      role: "tester",
    });
    (loader as any).merged.set("empty-role", meta);
    // raw_by_name: 빈 프론트매터만 (body 없음) → _strip_formatter → ""
    (loader as any).raw_by_name.set("empty-role", "---\nname: empty-role\ntype: role\nrole: tester\n---\n");

    const result = loader.load_role_context("tester");
    // body가 빈 문자열 → L454: if (!body) return null
    expect(result).toBeNull();
  });
});

// ── L480: register_alias — 빈 alias → return ────────────────────────────────

describe("SkillsLoader.register_alias — L480: 빈 alias → 조기 반환", () => {
  it("빈 alias_raw → normalize → 빈 문자열 → L480 return", () => {
    const ws = make_workspace();
    const loader = make_loader(ws);

    // 빈 alias_raw → normalize_skill_key("") → "" → if (!alias) return
    (loader as any).register_alias("", "some_skill");

    // alias_to_name에 등록되지 않음 (빈 alias는 무시)
    expect((loader as any).alias_to_name.has("")).toBe(false);
    expect(true).toBe(true); // 예외 없이 반환됨
  });
});
