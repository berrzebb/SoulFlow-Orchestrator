/**
 * SkillsLoader 종합 커버리지 — 메타데이터 파싱, 스킬 조회, 역할/별칭/공유 프로토콜.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SkillsLoader } from "@src/agent/skills.ts";

const SKILL_MD = `---
name: test-skill
summary: A test skill for unit testing
always: false
aliases:
- ts
- test_skill
triggers:
- test trigger
tools:
- bash
model: claude-opus-4-5
---
This is the skill body.
It does test things.
`;

const ROLE_MD = `---
name: tester-role
type: role
role: tester
soul: analytical
heart: precise
summary: A test role for unit testing
shared_protocols:
- common/style
---
Role body: be a tester.
`;

const ALWAYS_MD = `---
name: always-skill
summary: Always loaded skill
always: true
---
This always loads.
`;

const OAUTH_MD = `---
name: oauth-skill
summary: Uses OAuth
oauth:
- google
- github
---
OAuth skill body.
`;

const COMMANDS_MD = `---
name: review-cmd
summary: Review command
---
Review command body.
`;

let workspace: string;
let loader: SkillsLoader;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "skills-loader-test-"));
  const skills_root = join(workspace, "skills");
  mkdirSync(skills_root, { recursive: true });

  // 일반 스킬
  mkdirSync(join(skills_root, "test-skill"));
  writeFileSync(join(skills_root, "test-skill", "SKILL.md"), SKILL_MD);

  // 역할 스킬
  mkdirSync(join(skills_root, "tester-role"));
  writeFileSync(join(skills_root, "tester-role", "SKILL.md"), ROLE_MD);

  // always 스킬
  mkdirSync(join(skills_root, "always-skill"));
  writeFileSync(join(skills_root, "always-skill", "SKILL.md"), ALWAYS_MD);

  // oauth 스킬
  mkdirSync(join(skills_root, "oauth-skill"));
  writeFileSync(join(skills_root, "oauth-skill", "SKILL.md"), OAUTH_MD);

  // _shared 프로토콜
  mkdirSync(join(skills_root, "_shared", "common"), { recursive: true });
  writeFileSync(join(skills_root, "_shared", "common", "style.md"), "# Style Guide\nBe consistent.");

  // .claude/commands
  mkdirSync(join(workspace, ".claude", "commands"), { recursive: true });
  writeFileSync(join(workspace, ".claude", "commands", "review.md"), COMMANDS_MD);

  loader = new SkillsLoader(workspace);
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("SkillsLoader — 기본 조회", () => {
  it("list_skills: 모든 스킬 반환", () => {
    const skills = loader.list_skills();
    const names = skills.map((s) => s.name);
    expect(names).toContain("test-skill");
    expect(names).toContain("always-skill");
    expect(names).toContain("oauth-skill");
  });

  it("list_skills: role type 필터링", () => {
    const roles = loader.list_skills(false, "role");
    expect(roles.every((s) => s.type === "role")).toBe(true);
    const names = roles.map((s) => s.name);
    expect(names).toContain("tester-role");
  });

  it("list_skills: tool type 필터링", () => {
    const tools = loader.list_skills(false, "tool");
    expect(tools.every((s) => s.type === "tool")).toBe(true);
  });

  it("get_skill_metadata: 이름으로 조회", () => {
    const meta = loader.get_skill_metadata("test-skill");
    expect(meta).not.toBeNull();
    expect(meta!.name).toBe("test-skill");
    expect(meta!.summary).toBe("A test skill for unit testing");
    expect(meta!.model).toBe("claude-opus-4-5");
    expect(meta!.tools).toContain("bash");
  });

  it("get_skill_metadata: 별칭으로 조회", () => {
    const meta = loader.get_skill_metadata("ts");
    expect(meta).not.toBeNull();
    expect(meta!.name).toBe("test-skill");
  });

  it("get_skill_metadata: 대소문자 무관 조회", () => {
    const meta = loader.get_skill_metadata("TEST-SKILL");
    expect(meta).not.toBeNull();
    expect(meta!.name).toBe("test-skill");
  });

  it("get_skill_metadata: 없는 스킬 → null", () => {
    const meta = loader.get_skill_metadata("does-not-exist");
    expect(meta).toBeNull();
  });

  it("get_skill_metadata: 빈 이름 → null", () => {
    const meta = loader.get_skill_metadata("");
    expect(meta).toBeNull();
  });
});

describe("SkillsLoader — always/role 스킬", () => {
  it("get_always_skills: always=true인 스킬 반환", () => {
    const always = loader.get_always_skills();
    expect(always).toContain("always-skill");
    expect(always).not.toContain("test-skill");
  });

  it("get_role_skill: role 이름으로 조회", () => {
    const role = loader.get_role_skill("tester");
    expect(role).not.toBeNull();
    expect(role!.name).toBe("tester-role");
    expect(role!.soul).toBe("analytical");
    expect(role!.heart).toBe("precise");
  });

  it("get_role_skill: 없는 역할 → null", () => {
    const role = loader.get_role_skill("nonexistent-role");
    expect(role).toBeNull();
  });

  it("get_role_skill: 빈 role → null", () => {
    const role = loader.get_role_skill("");
    expect(role).toBeNull();
  });

  it("list_role_skills: 역할 스킬만 반환", () => {
    const roles = loader.list_role_skills();
    expect(roles.some((r) => r.name === "tester-role")).toBe(true);
    expect(roles.every((r) => r.type === "role")).toBe(true);
  });

  it("load_role_context: 역할 본문 + 공유 프로토콜 결합", () => {
    const ctx = loader.load_role_context("tester");
    expect(ctx).not.toBeNull();
    expect(ctx).toContain("Role body: be a tester.");
    expect(ctx).toContain("protocol:common/style");
    expect(ctx).toContain("Style Guide");
  });

  it("load_role_context: 없는 역할 → null", () => {
    const ctx = loader.load_role_context("ghost");
    expect(ctx).toBeNull();
  });
});

describe("SkillsLoader — load_skills_for_context", () => {
  it("지정된 스킬 본문 반환", () => {
    const ctx = loader.load_skills_for_context(["test-skill"]);
    expect(ctx).toContain("skill:test-skill");
    expect(ctx).toContain("This is the skill body.");
  });

  it("always 스킬은 항상 포함", () => {
    const ctx = loader.load_skills_for_context([]);
    expect(ctx).toContain("skill:always-skill");
  });

  it("없는 스킬 이름은 무시", () => {
    const ctx = loader.load_skills_for_context(["nonexistent-skill"]);
    // always-skill만 포함 (없는 스킬은 skip)
    expect(ctx).not.toContain("nonexistent-skill");
  });

  it("별칭으로도 로드 가능", () => {
    const ctx = loader.load_skills_for_context(["ts"]);  // "ts" is alias of test-skill
    expect(ctx).toContain("skill:test-skill");
  });
});

describe("SkillsLoader — build_skill_summary", () => {
  it("요약 문자열 생성 (role 제외)", () => {
    const summary = loader.build_skill_summary();
    expect(summary).toContain("test-skill");
    expect(summary).not.toContain("tester-role");
  });

  it("always 스킬은 [always] 태그 포함", () => {
    const summary = loader.build_skill_summary();
    expect(summary).toContain("always-skill");
    expect(summary).toContain("always");
  });

  it("model 정보 포함", () => {
    const summary = loader.build_skill_summary();
    expect(summary).toContain("model:");
  });
});

describe("SkillsLoader — suggest_skills_for_text", () => {
  it("이름 매칭으로 스킬 제안", () => {
    const suggestions = loader.suggest_skills_for_text("I need to test something");
    expect(suggestions).toContain("test-skill");
  });

  it("trigger 매칭으로 스킬 제안", () => {
    const suggestions = loader.suggest_skills_for_text("test trigger needed");
    expect(suggestions).toContain("test-skill");
  });

  it("빈 텍스트 → 빈 배열", () => {
    const suggestions = loader.suggest_skills_for_text("");
    expect(suggestions).toHaveLength(0);
  });

  it("limit 파라미터 준수", () => {
    const suggestions = loader.suggest_skills_for_text("skill", 1);
    expect(suggestions.length).toBeLessThanOrEqual(1);
  });

  it("role 스킬은 제안에서 제외", () => {
    const suggestions = loader.suggest_skills_for_text("tester role");
    expect(suggestions).not.toContain("tester-role");
  });
});

describe("SkillsLoader — 공유 프로토콜", () => {
  it("get_shared_protocol: 이름으로 조회", () => {
    const proto = loader.get_shared_protocol("common/style");
    expect(proto).toContain("Style Guide");
  });

  it("get_shared_protocol: 없는 프로토콜 → null", () => {
    const proto = loader.get_shared_protocol("nonexistent/proto");
    expect(proto).toBeNull();
  });

  it("list_shared_protocols: 등록된 프로토콜 이름 목록 반환", () => {
    const names = loader.list_shared_protocols();
    expect(names).toContain("common/style");
    expect(names.length).toBeGreaterThanOrEqual(1);
  });
});

describe("SkillsLoader — 내부 파싱 메서드", () => {
  it("_parse_metadata: frontmatter 파싱", () => {
    const raw = "---\nname: foo\nsummary: bar\nalways: true\n---\nbody";
    const meta = (loader as any)._parse_metadata(raw);
    expect(meta.name).toBe("foo");
    expect(meta.summary).toBe("bar");
    expect(meta.always).toBe(true);
  });

  it("_parse_metadata: frontmatter 없으면 빈 객체", () => {
    const meta = (loader as any)._parse_metadata("no frontmatter here");
    expect(Object.keys(meta)).toHaveLength(0);
  });

  it("_parse_metadata: 리스트 항목 파싱", () => {
    const raw = "---\naliases:\n- a\n- b\n---\nbody";
    const meta = (loader as any)._parse_metadata(raw);
    expect(meta.aliases).toEqual(["a", "b"]);
  });

  it("_parse_metadata: false 값 파싱", () => {
    const raw = "---\nalways: false\n---\nbody";
    const meta = (loader as any)._parse_metadata(raw);
    expect(meta.always).toBe(false);
  });

  it("_strip_formatter: frontmatter 제거하고 본문만 반환", () => {
    const raw = "---\nname: test\n---\nbody content";
    const body = (loader as any)._strip_formatter(raw);
    expect(body).toBe("body content");
  });

  it("_strip_formatter: frontmatter 없으면 전체 반환", () => {
    const raw = "just body";
    const body = (loader as any)._strip_formatter(raw);
    expect(body).toBe("just body");
  });

  it("_check_requirements: requires 없으면 true", () => {
    const ok = (loader as any)._check_requirements({});
    expect(ok).toBe(true);
  });

  it("_check_requirements: env 요구사항 충족 시 true", () => {
    process.env["TEST_EXISTING_VAR"] = "1";
    const ok = (loader as any)._check_requirements({ requires: ["env:TEST_EXISTING_VAR"] });
    expect(ok).toBe(true);
    delete process.env["TEST_EXISTING_VAR"];
  });

  it("_check_requirements: env 요구사항 미충족 시 false", () => {
    const ok = (loader as any)._check_requirements({ requires: ["env:TOTALLY_NONEXISTENT_VAR_XYZ"] });
    expect(ok).toBe(false);
  });

  it("_check_requirements: optional env 미충족 시에도 true", () => {
    const ok = (loader as any)._check_requirements({ requires: ["?env:NONEXISTENT_OPTIONAL_VAR"] });
    expect(ok).toBe(true);
  });

  it("_get_missing_requirements: file 요구사항 → 없으면 missing 반환", () => {
    const missing = (loader as any)._get_missing_requirements({ requires: ["file:/nonexistent/path/file.txt"] });
    expect(missing).toContain("file:");
  });
});

describe("SkillsLoader — oauth 스킬 처리", () => {
  it("oauth 스킬은 oauth_fetch 도구 자동 추가", () => {
    const meta = loader.get_skill_metadata("oauth-skill");
    expect(meta).not.toBeNull();
    expect(meta!.oauth).toContain("google");
    expect(meta!.tools).toContain("oauth_fetch");
  });
});

describe("SkillsLoader — .claude/commands 로드", () => {
  it("commands 디렉토리의 .md 파일을 스킬로 로드", () => {
    const meta = loader.get_skill_metadata("review-cmd");
    expect(meta).not.toBeNull();
    expect(meta!.summary).toBe("Review command");
  });
});

describe("SkillsLoader — refresh", () => {
  it("refresh() 후 새 스킬 감지", () => {
    const skills_root = join(workspace, "skills");
    mkdirSync(join(skills_root, "new-skill"), { recursive: true });
    writeFileSync(
      join(skills_root, "new-skill", "SKILL.md"),
      "---\nname: new-skill\nsummary: newly added\n---\nnew skill body",
    );
    loader.refresh();
    const meta = loader.get_skill_metadata("new-skill");
    expect(meta).not.toBeNull();
    expect(meta!.summary).toBe("newly added");
  });
});

// ══════════════════════════════════════════
// Extended: _extract_summary, filter_unavailable, _parse_metadata, suggest, _get_missing_requirements
// ══════════════════════════════════════════

describe("SkillsLoader — _extract_summary (extended)", () => {
  it("_extract_summary 직접 호출 — 빈 줄만 있으면 'No summary.'", () => {
    const summary = (loader as any)._extract_summary("   \n  \n\n");
    expect(summary).toBe("No summary.");
  });

  it("_extract_summary 직접 호출 — 첫 비헤딩 라인 반환", () => {
    const summary = (loader as any)._extract_summary("# heading\nactual content\n");
    expect(summary).toBe("actual content");
  });
});

describe("SkillsLoader — list_skills filter_unavailable", () => {
  it("filter_unavailable=true → 조건 미충족 스킬 제외", () => {
    // First create the env-skill and heading-only if not already present
    const skills_root = join(workspace, "skills");
    if (!existsSync(join(skills_root, "env-skill"))) {
      mkdirSync(join(skills_root, "env-skill"), { recursive: true });
      writeFileSync(join(skills_root, "env-skill", "SKILL.md"), "---\nname: env-skill\nsummary: Needs env var\nrequires:\n- env:TOTALLY_MISSING_ENV_VAR_12345\n---\nBody.\n");
    }
    if (!existsSync(join(skills_root, "heading-only"))) {
      mkdirSync(join(skills_root, "heading-only"), { recursive: true });
      writeFileSync(join(skills_root, "heading-only", "SKILL.md"), "---\nname: heading-only\n---\n# Just a heading\n## Another heading\n");
    }
    loader.refresh();
    const all = loader.list_skills(false);
    const filtered = loader.list_skills(true);
    const all_names = all.map((s) => s.name);
    const filtered_names = filtered.map((s) => s.name);
    if (all_names.includes("env-skill")) {
      expect(filtered_names).not.toContain("env-skill");
    }
    expect(filtered_names).toContain("heading-only");
  });
});

describe("SkillsLoader — _parse_metadata extended", () => {
  it("kv 미매칭 라인 → skip", () => {
    const raw = "---\nname: foo\n!invalid-line\nstatus: ok\n---\nbody";
    const meta = (loader as any)._parse_metadata(raw);
    expect(meta.name).toBe("foo");
    expect(meta.status).toBe("ok");
  });

  it("quoted string value → 따옴표 제거", () => {
    const raw = "---\nname: \"quoted-name\"\n---\nbody";
    const meta = (loader as any)._parse_metadata(raw);
    expect(meta.name).toBe("quoted-name");
  });

  it("single-quoted string value → 따옴표 제거", () => {
    const raw = "---\nname: 'single-quoted'\n---\nbody";
    const meta = (loader as any)._parse_metadata(raw);
    expect(meta.name).toBe("single-quoted");
  });
});

describe("SkillsLoader — suggest_skills_for_text extended", () => {
  it("limit 20 상한 적용", () => {
    const suggestions = loader.suggest_skills_for_text("skill", 100);
    expect(suggestions.length).toBeLessThanOrEqual(20);
  });

  it("limit 0 → max(1, 0)=1 상한", () => {
    const suggestions = loader.suggest_skills_for_text("skill", 0);
    expect(suggestions.length).toBeLessThanOrEqual(1);
  });
});

describe("SkillsLoader — _get_missing_requirements file case", () => {
  it("file 요구사항 — 워크스페이스 상대 경로로 존재 시 → missing 없음", () => {
    writeFileSync(join(workspace, "existing_req.txt"), "content");
    const missing = (loader as any)._get_missing_requirements({
      requires: ["file:existing_req.txt"],
    });
    expect(missing).toBe("");
  });

  it("non-env/file prefix → skip (missing 없음)", () => {
    const missing = (loader as any)._get_missing_requirements({
      requires: ["custom:some_value"],
    });
    expect(missing).toBe("");
  });
});

describe("SkillsLoader — _resolve_skill_name 빈 이름", () => {
  it("빈 이름 → null", () => {
    const meta = loader.get_skill_metadata("   ");
    expect(meta).toBeNull();
  });
});
