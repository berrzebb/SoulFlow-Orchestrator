/**
 * SkillsLoader — 미커버 분기 보충 통합 (coverage + cov2-5).
 * skills-loader.test.ts / skills-loader-extended.test.ts에서 커버하지 않는 분기만 수집.
 */
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SkillsLoader } from "@src/agent/skills.service.js";
import type { SkillMetadata } from "@src/agent/skills.types.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "skills-svc-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function write_skill(
  root: string,
  skill_name: string,
  frontmatter: string,
  body = "스킬 본문",
) {
  const dir = join(root, skill_name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n${body}`);
}

async function write_commands_md(
  commands_dir: string,
  name: string,
  fm: string,
  body: string,
) {
  await mkdir(commands_dir, { recursive: true });
  await writeFile(join(commands_dir, `${name}.md`), `---\n${fm}\n---\n${body}`);
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

// ══════════════════════════════════════════
// load_skills_for_context — 미커버 분기
// ══════════════════════════════════════════

describe("SkillsLoader — load_skills_for_context 미커버 분기", () => {
  it("requirements 미충족 always 스킬 → 제외", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(
      skills_root,
      "env-skill",
      "name: env-skill\nalways: true\nrequires:\n- env:NONEXISTENT_ENV_VAR_12345",
      "env 스킬 내용",
    );

    const loader = new SkillsLoader(workspace);
    const ctx = loader.load_skills_for_context([]);
    expect(ctx).not.toContain("env-skill");
  });

  it("raw 없는 스킬(빈 body) → 컨텍스트에서 건너뜀", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "empty-skill", "name: empty-skill", "");

    const loader = new SkillsLoader(workspace);
    const ctx = loader.load_skills_for_context(["empty-skill"]);
    expect(ctx).not.toContain("empty-skill");
  });

  it("env requirements 미충족 명시적 스킬 → 제외", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(
      skills_root,
      "gated",
      "name: gated\nrequires:\n- env:NONEXISTENT_SKILLS_ENV_99XYZ",
      "게이팅된 스킬 내용",
    );

    const loader = new SkillsLoader(workspace);
    const ctx = loader.load_skills_for_context(["gated"]);
    expect(ctx).not.toContain("게이팅된 스킬");
  });

  it("optional env requirements → 포함", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(
      skills_root,
      "optional-req",
      "name: optional-req\nrequires:\n- ?env:NONEXISTENT_OPTIONAL_ENV_XYZ",
      "선택적 스킬 내용",
    );

    const loader = new SkillsLoader(workspace);
    const ctx = loader.load_skills_for_context(["optional-req"]);
    expect(ctx).toContain("선택적 스킬 내용");
  });
});

// ══════════════════════════════════════════
// build_skill_summary — 미커버 분기
// ══════════════════════════════════════════

describe("SkillsLoader — build_skill_summary 미커버 분기", () => {
  it("tools 지정 → [tools:xxx] 태그 포함", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "fetch-tool", "name: fetch-tool\ntools: web_search,http_fetch", "fetch 도구");

    const loader = new SkillsLoader(workspace);
    const summary = loader.build_skill_summary();
    expect(summary).toContain("tools:");
  });

  it("oauth 지정 → [oauth:xxx] 태그 포함", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "oauth-tool", "name: oauth-tool\noauth: google", "oauth 도구");

    const loader = new SkillsLoader(workspace);
    const summary = loader.build_skill_summary();
    expect(summary).toContain("oauth:");
  });

  it("requirements 미충족 스킬은 요약에서 제외", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "visible-skill", "name: visible-skill\nsummary: 보이는 스킬", "내용");
    await write_skill(
      skills_root,
      "hidden-skill",
      "name: hidden-skill\nsummary: 숨겨진\nrequires:\n- env:MISSING_ENV_BUILD_SUMMARY_TEST",
      "숨겨진",
    );

    const loader = new SkillsLoader(workspace);
    const summary = loader.build_skill_summary();
    expect(summary).toContain("visible-skill");
    expect(summary).not.toContain("hidden-skill");
  });
});

// ══════════════════════════════════════════
// suggest_skills_for_text — 미커버 분기
// ══════════════════════════════════════════

describe("SkillsLoader — suggest_skills_for_text 미커버 분기", () => {
  it("별칭 매치 → 결과 포함", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(
      skills_root,
      "translator",
      "name: translator\naliases: trans,번역기\nsummary: 번역 도구",
      "번역 기능",
    );

    const loader = new SkillsLoader(workspace);
    const results = loader.suggest_skills_for_text("trans 써서 번역해줘");
    expect(results).toContain("translator");
  });

  it("동일 trigger 가진 두 스킬 → 점수 동점 → 이름 알파벳순 정렬", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "beta-skill", "name: beta-skill\ntriggers:\n- helper", "Beta");
    await write_skill(skills_root, "alpha-skill", "name: alpha-skill\ntriggers:\n- helper", "Alpha");

    const loader = new SkillsLoader(workspace);
    const results = loader.suggest_skills_for_text("helper query", 10);
    expect(results.length).toBeGreaterThanOrEqual(2);
    const alpha_idx = results.indexOf("alpha-skill");
    const beta_idx = results.indexOf("beta-skill");
    expect(alpha_idx).toBeGreaterThanOrEqual(0);
    expect(beta_idx).toBeGreaterThanOrEqual(0);
    expect(alpha_idx).toBeLessThan(beta_idx);
  });

  it("이름 매칭(+6) vs 트리거 매칭(+5) → 점수순 정렬", () => {
    const loader = new SkillsLoader(workspace);

    (loader as any).merged.set("alpha", make_meta("alpha", {
      summary: "general purpose",
      triggers: [],
      aliases: [],
    }));
    (loader as any).merged.set("omega", make_meta("omega", {
      summary: "general purpose",
      triggers: ["beta"],
      aliases: [],
    }));

    const result = loader.suggest_skills_for_text("alpha beta task", 10);
    expect(result.length).toBeGreaterThanOrEqual(2);
    const idx_alpha = result.indexOf("alpha");
    const idx_omega = result.indexOf("omega");
    expect(idx_alpha).toBeGreaterThanOrEqual(0);
    expect(idx_omega).toBeGreaterThanOrEqual(0);
    expect(idx_alpha).toBeLessThan(idx_omega);
  });

  it("빈 alias → normalize → skip, 유효한 alias만 처리", () => {
    const loader = new SkillsLoader(workspace);

    const meta = make_meta("code-skill", {
      aliases: ["coder", "", "dev"],
    });
    (loader as any).merged.set("code-skill", meta);

    const result = loader.suggest_skills_for_text("coder");
    expect(Array.isArray(result)).toBe(true);
    expect(result).toContain("code-skill");
  });

  it("빈 trigger → normalize → skip, 유효한 trigger만 처리", () => {
    const loader = new SkillsLoader(workspace);

    const meta = make_meta("report-skill", {
      triggers: ["", "보고서", ""],
    });
    (loader as any).merged.set("report-skill", meta);

    const result = loader.suggest_skills_for_text("보고서 작성해줘");
    expect(Array.isArray(result)).toBe(true);
    expect(result).toContain("report-skill");
  });
});

// ══════════════════════════════════════════
// .claude/commands — 미커버 분기
// ══════════════════════════════════════════

describe("SkillsLoader — .claude/commands 미커버 분기", () => {
  it("commands/*.md oauth → tools에 oauth_fetch 자동 추가", async () => {
    const commands_dir = join(workspace, ".claude", "commands");
    await write_commands_md(commands_dir, "oauth-cmd", "name: oauth-cmd\noauth: github", "OAuth 커맨드");

    const loader = new SkillsLoader(workspace);
    const meta = loader.get_skill_metadata("oauth-cmd");
    expect(meta).not.toBeNull();
    expect(meta?.tools).toContain("oauth_fetch");
    expect(meta?.oauth).toContain("github");
  });

  it("commands/*.md load: always → always=true", async () => {
    const commands_dir = join(workspace, ".claude", "commands");
    await write_commands_md(commands_dir, "auto-cmd", "name: auto-cmd\nload: always", "자동 로드 커맨드");

    const loader = new SkillsLoader(workspace);
    const always = loader.get_always_skills();
    expect(always).toContain("auto-cmd");
  });

  it("commands/*.md type:role → role 스킬로 로드", async () => {
    const commands_dir = join(workspace, ".claude", "commands");
    await write_commands_md(commands_dir, "role-cmd", "name: role-cmd\ntype: role\nrole: researcher", "연구자 역할");

    const loader = new SkillsLoader(workspace);
    const role_meta = loader.get_role_skill("researcher");
    expect(role_meta).not.toBeNull();
    expect(role_meta?.name).toBe("role-cmd");
  });

  it("type:role이지만 role 필드 없음 → name으로 fallback", async () => {
    const commands_dir = join(workspace, ".claude", "commands");
    await write_commands_md(commands_dir, "noname-role", "name: noname-role\ntype: role", "역할 내용");

    const loader = new SkillsLoader(workspace);
    const meta = loader.get_skill_metadata("noname-role");
    expect(meta?.type).toBe("role");
    expect(meta?.role).toBe("noname-role");
  });

  it(".md 아닌 파일 → skip", () => {
    const ws = workspace;
    const commands = join(ws, ".claude", "commands");
    mkdirSync(commands, { recursive: true });
    writeFileSync(join(commands, "readme.txt"), "text");
    writeFileSync(join(commands, "config.json"), "{}");

    const loader = new SkillsLoader(ws);
    expect(loader.list_skills().length).toBe(0);
  });

  it(".md 이름 디렉토리 → skip", () => {
    const ws = workspace;
    const commands = join(ws, ".claude", "commands");
    mkdirSync(commands, { recursive: true });
    mkdirSync(join(commands, "subdir.md"), { recursive: true });

    const loader = new SkillsLoader(ws);
    expect(loader.list_skills().length).toBe(0);
  });

  it("같은 이름 .md 두 개 → 두 번째 skip", () => {
    const ws = workspace;
    const commands = join(ws, ".claude", "commands");
    mkdirSync(commands, { recursive: true });
    writeFileSync(join(commands, "skill1.md"), "---\nname: duplicate\n---\nFirst body");
    writeFileSync(join(commands, "skill2.md"), "---\nname: duplicate\n---\nSecond body (skipped)");

    const loader = new SkillsLoader(ws);
    const dup_count = loader.list_skills().filter(s => s.name === "duplicate").length;
    expect(dup_count).toBe(1);
  });

  it("프론트매터에 빈 줄 포함 → 나머지 정상 파싱", () => {
    const ws = workspace;
    const commands = join(ws, ".claude", "commands");
    mkdirSync(commands, { recursive: true });
    writeFileSync(
      join(commands, "blank_line_skill.md"),
      "---\nname: blank-line-skill\n\ndescription: after blank line\n---\nSkill body here.",
    );

    const loader = new SkillsLoader(ws);
    const meta = loader.get_skill_metadata("blank-line-skill");
    expect(meta).not.toBeNull();
    expect(meta?.name).toBe("blank-line-skill");
  });
});

// ══════════════════════════════════════════
// parse_meta_string_list — 쉼표 구분 / 단일 문자열
// ══════════════════════════════════════════

describe("SkillsLoader — parse_meta_string_list 문자열 입력", () => {
  it("쉼표 구분 문자열 → 분리된 배열", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "multi-tool", "name: multi-tool\ntools: search,fetch,write", "멀티 도구");

    const loader = new SkillsLoader(workspace);
    const meta = loader.get_skill_metadata("multi-tool");
    expect(meta?.tools).toContain("search");
    expect(meta?.tools).toContain("fetch");
    expect(meta?.tools).toContain("write");
    expect(meta?.tools.length).toBe(3);
  });

  it("단일 문자열(쉼표 없음) → 단일 항목 배열", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "single-alias", "name: single-alias\naliases: sa", "단일 별칭");

    const loader = new SkillsLoader(workspace);
    const meta = loader.get_skill_metadata("single-alias");
    expect(meta?.aliases).toEqual(["sa"]);
  });
});

// ══════════════════════════════════════════
// 공유 프로토콜 — 서브디렉토리 네임스페이스
// ══════════════════════════════════════════

describe("SkillsLoader — 공유 프로토콜 서브디렉토리 네임스페이스", () => {
  it("_shared 하위 서브디렉토리 → 네임스페이스 키로 조회", async () => {
    const skills_root = join(workspace, "skills");
    const lang_dir = join(skills_root, "_shared", "lang");
    await mkdir(lang_dir, { recursive: true });
    await writeFile(join(lang_dir, "typescript.md"), "# TypeScript 가이드");

    const loader = new SkillsLoader(workspace);
    const content = loader.get_shared_protocol("lang/typescript");
    expect(content).toContain("TypeScript 가이드");
  });
});

// ══════════════════════════════════════════
// _resolve_skill_name — 미커버 분기
// ══════════════════════════════════════════

describe("SkillsLoader — _resolve_skill_name 미커버 분기", () => {
  it("alias 미등록 + merged에 다른 케이스 이름 → 루프 매칭", () => {
    const loader = new SkillsLoader(workspace);

    const meta = make_meta("SpecialSkill");
    (loader as any).merged.set("SpecialSkill", meta);

    const resolved = (loader as any)._resolve_skill_name("specialskill");
    expect(resolved).toBe("SpecialSkill");
  });

  it("별칭이 정규화된 형태로 조회됨 (하이픈 → 언더스코어)", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "aliased-skill", "name: aliased-skill\naliases: my-alias", "별칭 스킬");

    const loader = new SkillsLoader(workspace);
    const meta = loader.get_skill_metadata("my alias");
    expect(meta).not.toBeNull();
    expect(meta?.name).toBe("aliased-skill");
  });
});

// ══════════════════════════════════════════
// 내부 메서드 — 미커버 분기
// ══════════════════════════════════════════

describe("SkillsLoader — 내부 메서드 미커버 분기", () => {
  it("register_alias: 빈 alias → 조기 반환", () => {
    const loader = new SkillsLoader(workspace);
    (loader as any).register_alias("", "some_skill");
    expect((loader as any).alias_to_name.has("")).toBe(false);
  });

  it("load_role_context: body 빈 문자열 → null 반환", () => {
    const loader = new SkillsLoader(workspace);

    const meta = make_meta("empty-role", { type: "role", role: "tester" });
    (loader as any).merged.set("empty-role", meta);
    (loader as any).raw_by_name.set("empty-role", "---\nname: empty-role\ntype: role\nrole: tester\n---\n");

    const result = loader.load_role_context("tester");
    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════
// 기타 — 미커버 분기
// ══════════════════════════════════════════

describe("SkillsLoader — 기타 미커버 분기", () => {
  it("autoload: true → always=true로 처리", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "autoloaded", "name: autoloaded\nautoload: true", "자동 로드 스킬");

    const loader = new SkillsLoader(workspace);
    const meta = loader.get_skill_metadata("autoloaded");
    expect(meta?.always).toBe(true);
  });

  it("SKILL.md에 load: always → always=true", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "load-always-skill", "name: load-always-skill\nload: always", "load always 스킬");

    const loader = new SkillsLoader(workspace);
    const always = loader.get_always_skills();
    expect(always).toContain("load-always-skill");
  });

  it("app_root가 주어지면 builtin_skills 경로도 탐색", async () => {
    const app_root = await mkdtemp(join(tmpdir(), "skills-app-root-"));
    try {
      const builtin_dir = join(app_root, "builtin_skills");
      await mkdir(builtin_dir, { recursive: true });
      await write_skill(builtin_dir, "builtin-skill", "name: builtin-skill", "빌트인 스킬");

      const loader = new SkillsLoader(workspace, app_root);
      const meta = loader.get_skill_metadata("builtin-skill");
      expect(meta).not.toBeNull();
      expect(meta?.source).toBe("builtin_skills");
    } finally {
      await rm(app_root, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("get_always_skills: requirements 미충족 always 스킬 → 제외", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(
      skills_root,
      "gated-always",
      "name: gated-always\nalways: true\nrequires:\n- env:NEVER_SET_ENV_XYZ",
      "조건부 항상 스킬",
    );

    const loader = new SkillsLoader(workspace);
    const always = loader.get_always_skills();
    expect(always).not.toContain("gated-always");
  });
});
