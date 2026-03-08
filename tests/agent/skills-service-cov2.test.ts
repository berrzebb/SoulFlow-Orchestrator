/**
 * SkillsLoader — 미커버 분기 보충.
 * load_skills_for_context: 명시적 스킬 requirements 미충족 → 제외,
 * build_skill_summary: requirements 미충족 스킬 제외,
 * _scan_flat_md: oauth 자동 oauth_fetch 추가, load:always 동의어,
 * collect_builtin_skill_roots app_root 경로,
 * _resolve_skill_name: alias를 정규화 후 매칭.
 */
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SkillsLoader } from "@src/agent/skills.service.js";

let workspace: string;

async function write_skill(skills_root: string, name: string, fm: string, body: string): Promise<void> {
  const dir = join(skills_root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\n${fm}\n---\n${body}`);
}

async function write_commands_md(commands_dir: string, name: string, fm: string, body: string): Promise<void> {
  await mkdir(commands_dir, { recursive: true });
  await writeFile(join(commands_dir, `${name}.md`), `---\n${fm}\n---\n${body}`);
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "skills-cov2-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true }).catch(() => {});
});

// ══════════════════════════════════════════
// load_skills_for_context — 명시적 스킬 requirements 미충족
// ══════════════════════════════════════════

describe("SkillsLoader — load_skills_for_context: 명시적 스킬 requirements 미충족 → 제외", () => {
  it("env requirements 미충족 스킬을 명시적으로 지정해도 제외됨", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(
      skills_root,
      "gated",
      "name: gated\nrequires:\n- env:NONEXISTENT_SKILLS_ENV_99XYZ",
      "게이팅된 스킬 내용",
    );

    const loader = new SkillsLoader(workspace);
    // explicitly named but requirements fail → should be excluded
    const ctx = loader.load_skills_for_context(["gated"]);
    expect(ctx).not.toContain("게이팅된 스킬");
  });

  it("optional env requirements → 충족된 것으로 판단되어 포함됨", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(
      skills_root,
      "optional-req",
      "name: optional-req\nrequires:\n- ?env:NONEXISTENT_OPTIONAL_ENV_XYZ",
      "선택적 스킬 내용",
    );

    const loader = new SkillsLoader(workspace);
    const ctx = loader.load_skills_for_context(["optional-req"]);
    // optional requirements → _check_requirements returns true → included
    expect(ctx).toContain("선택적 스킬 내용");
  });
});

// ══════════════════════════════════════════
// build_skill_summary — requirements 미충족 스킬 제외
// ══════════════════════════════════════════

describe("SkillsLoader — build_skill_summary: requirements 미충족 → 제외", () => {
  it("env requirements 미충족 스킬은 요약에서 제외됨", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(
      skills_root,
      "visible-skill",
      "name: visible-skill\nsummary: 보이는 스킬",
      "보이는 내용",
    );
    await write_skill(
      skills_root,
      "hidden-skill",
      "name: hidden-skill\nsummary: 숨겨진 스킬\nrequires:\n- env:MISSING_ENV_BUILD_SUMMARY_TEST",
      "숨겨진 내용",
    );

    const loader = new SkillsLoader(workspace);
    const summary = loader.build_skill_summary();
    expect(summary).toContain("visible-skill");
    expect(summary).not.toContain("hidden-skill");
  });
});

// ══════════════════════════════════════════
// _scan_flat_md — oauth 자동 oauth_fetch 추가
// ══════════════════════════════════════════

describe("SkillsLoader — .claude/commands oauth 자동 oauth_fetch 추가", () => {
  it("commands/*.md에 oauth 필드 있으면 tools에 oauth_fetch 자동 추가됨", async () => {
    const commands_dir = join(workspace, ".claude", "commands");
    await write_commands_md(
      commands_dir,
      "oauth-cmd",
      "name: oauth-cmd\noauth: github",
      "OAuth 커맨드",
    );

    const loader = new SkillsLoader(workspace);
    const meta = loader.get_skill_metadata("oauth-cmd");
    expect(meta).not.toBeNull();
    expect(meta?.tools).toContain("oauth_fetch");
    expect(meta?.oauth).toContain("github");
  });
});

// ══════════════════════════════════════════
// _scan_flat_md — load:always 동의어
// ══════════════════════════════════════════

describe("SkillsLoader — .claude/commands load:always 동의어", () => {
  it("commands/*.md에 load: always → always=true로 처리됨", async () => {
    const commands_dir = join(workspace, ".claude", "commands");
    await write_commands_md(
      commands_dir,
      "auto-cmd",
      "name: auto-cmd\nload: always",
      "자동 로드 커맨드",
    );

    const loader = new SkillsLoader(workspace);
    const always = loader.get_always_skills();
    expect(always).toContain("auto-cmd");
  });
});

// ══════════════════════════════════════════
// _scan_flat_md — role 타입 스킬 (type:role frontmatter)
// ══════════════════════════════════════════

describe("SkillsLoader — .claude/commands type:role 스킬", () => {
  it("type:role인 commands/*.md는 role 스킬로 로드됨", async () => {
    const commands_dir = join(workspace, ".claude", "commands");
    await write_commands_md(
      commands_dir,
      "role-cmd",
      "name: role-cmd\ntype: role\nrole: researcher",
      "연구자 역할 내용",
    );

    const loader = new SkillsLoader(workspace);
    const meta = loader.get_skill_metadata("role-cmd");
    expect(meta?.type).toBe("role");
    // role 필드가 없는 경우 name으로 fallback은 meta.role에 기록됨
    const role_meta = loader.get_role_skill("researcher");
    expect(role_meta).not.toBeNull();
    expect(role_meta?.name).toBe("role-cmd");
  });
});

// ══════════════════════════════════════════
// _scan_flat_md — role type fallback to name
// ══════════════════════════════════════════

describe("SkillsLoader — _scan_flat_md role 필드 없으면 name으로 fallback", () => {
  it("type:role이지만 role 필드 없음 → name으로 fallback", async () => {
    const commands_dir = join(workspace, ".claude", "commands");
    // role 필드 없이 type:role만 지정
    await write_commands_md(
      commands_dir,
      "noname-role",
      "name: noname-role\ntype: role",
      "역할 내용",
    );

    const loader = new SkillsLoader(workspace);
    const meta = loader.get_skill_metadata("noname-role");
    expect(meta?.type).toBe("role");
    // role이 없으므로 name="noname-role"으로 fallback
    expect(meta?.role).toBe("noname-role");
  });
});

// ══════════════════════════════════════════
// _scan_source — load:always 동의어 (SKILL.md)
// ══════════════════════════════════════════

describe("SkillsLoader — _scan_source load:always 동의어 (SKILL.md)", () => {
  it("SKILL.md에 load: always → always=true로 처리됨", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "load-always-skill", "name: load-always-skill\nload: always", "load always 스킬");

    const loader = new SkillsLoader(workspace);
    const always = loader.get_always_skills();
    expect(always).toContain("load-always-skill");
  });
});

// ══════════════════════════════════════════
// _resolve_skill_name — alias 정규화 매칭
// ══════════════════════════════════════════

describe("SkillsLoader — _resolve_skill_name alias 정규화 매칭", () => {
  it("별칭이 정규화된 형태로 조회됨", async () => {
    const skills_root = join(workspace, "skills");
    // 'my-alias' 별칭을 가진 스킬 — normalize_skill_key("my-alias") = "my_alias"
    await write_skill(skills_root, "aliased-skill", "name: aliased-skill\naliases: my-alias", "별칭 스킬 내용");

    const loader = new SkillsLoader(workspace);
    // "my alias" → normalize → "my_alias" → alias map에서 "aliased-skill" 조회
    const meta = loader.get_skill_metadata("my alias");
    expect(meta).not.toBeNull();
    expect(meta?.name).toBe("aliased-skill");
  });
});

// ══════════════════════════════════════════
// collect_builtin_skill_roots — app_root 경로
// ══════════════════════════════════════════

describe("SkillsLoader — collect_builtin_skill_roots app_root 경로", () => {
  it("app_root가 주어지면 해당 경로도 탐색됨", async () => {
    // app_root에 builtin_skills 디렉토리 생성
    const app_root = await mkdtemp(join(tmpdir(), "skills-app-root-"));
    const builtin_dir = join(app_root, "builtin_skills");
    await mkdir(builtin_dir, { recursive: true });
    await write_skill(builtin_dir, "builtin-skill", "name: builtin-skill", "빌트인 스킬 내용");

    const loader = new SkillsLoader(workspace, app_root);
    const meta = loader.get_skill_metadata("builtin-skill");
    expect(meta).not.toBeNull();
    expect(meta?.source).toBe("builtin_skills");

    await rm(app_root, { recursive: true, force: true }).catch(() => {});
  });
});
