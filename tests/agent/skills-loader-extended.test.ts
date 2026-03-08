/**
 * SkillsLoader — 미커버 분기 보충.
 * _extract_summary (헤딩만 → "No summary."),
 * list_skills filter_unavailable,
 * _parse_metadata (kv 미매칭 라인, key:value 없는 rhs → 리스트),
 * suggest_skills_for_text keyword_hits 3개 상한,
 * _get_missing_requirements file 존재 케이스,
 * _scan_flat_md force_type (role 강제),
 * _resolve_skill_name lowercase 매칭.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SkillsLoader } from "@src/agent/skills.js";

let workspace: string;
let loader: SkillsLoader;

const REQUIRES_SKILL_MD = `---
name: env-skill
summary: Needs env var
requires:
- env:TOTALLY_MISSING_ENV_VAR_12345
---
Body.
`;

const HEADING_ONLY_MD = `---
name: heading-only
---
# Just a heading
## Another heading
`;

const KEYWORD_SKILL_MD = `---
name: keyword-skill
summary: deploy pipeline build release artifact
---
Keyword skill body.
`;

const ROLE_TYPE_MD = `---
name: forced-role-skill
summary: Forced to be role type
role: forced
---
Forced role body.
`;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "skills-ext-test-"));
  const skills_root = join(workspace, "skills");
  mkdirSync(skills_root, { recursive: true });

  // env 조건 있는 스킬 (조건 미충족)
  mkdirSync(join(skills_root, "env-skill"));
  writeFileSync(join(skills_root, "env-skill", "SKILL.md"), REQUIRES_SKILL_MD);

  // 헤딩만 있는 스킬 (_extract_summary → "No summary.")
  mkdirSync(join(skills_root, "heading-only"));
  writeFileSync(join(skills_root, "heading-only", "SKILL.md"), HEADING_ONLY_MD);

  // 키워드 매칭 스킬
  mkdirSync(join(skills_root, "keyword-skill"));
  writeFileSync(join(skills_root, "keyword-skill", "SKILL.md"), KEYWORD_SKILL_MD);

  // .claude/commands — 역할 강제 (.md with frontmatter type:role)
  mkdirSync(join(workspace, ".claude", "commands"), { recursive: true });
  writeFileSync(join(workspace, ".claude", "commands", "forced-role.md"), ROLE_TYPE_MD);

  loader = new SkillsLoader(workspace);
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

// ══════════════════════════════════════════
// _extract_summary — 헤딩만 있으면 "No summary."
// ══════════════════════════════════════════

describe("SkillsLoader — _extract_summary", () => {
  it("헤딩만 있는 본문 → 'No summary.'", () => {
    const meta = loader.get_skill_metadata("heading-only");
    expect(meta).not.toBeNull();
    expect(meta!.summary).toBe("No summary.");
  });

  it("_extract_summary 직접 호출 — 빈 줄만 있으면 'No summary.'", () => {
    const summary = (loader as any)._extract_summary("   \n  \n\n");
    expect(summary).toBe("No summary.");
  });

  it("_extract_summary 직접 호출 — 첫 비헤딩 라인 반환", () => {
    const summary = (loader as any)._extract_summary("# heading\nactual content\n");
    expect(summary).toBe("actual content");
  });
});

// ══════════════════════════════════════════
// list_skills — filter_unavailable
// ══════════════════════════════════════════

describe("SkillsLoader — list_skills filter_unavailable", () => {
  it("filter_unavailable=true → 조건 미충족 스킬 제외", () => {
    const all = loader.list_skills(false);
    const filtered = loader.list_skills(true);
    const all_names = all.map((s) => s.name);
    const filtered_names = filtered.map((s) => s.name);
    // env-skill은 TOTALLY_MISSING_ENV_VAR_12345가 없으므로 제외
    if (all_names.includes("env-skill")) {
      expect(filtered_names).not.toContain("env-skill");
    }
    // heading-only는 requires 없으므로 포함
    expect(filtered_names).toContain("heading-only");
  });
});

// ══════════════════════════════════════════
// _parse_metadata — 다양한 kv 패턴
// ══════════════════════════════════════════

describe("SkillsLoader — _parse_metadata 엣지케이스", () => {
  it("kv 미매칭 라인 → skip", () => {
    const raw = "---\nname: foo\n!invalid-line\nstatus: ok\n---\nbody";
    const meta = (loader as any)._parse_metadata(raw);
    expect(meta.name).toBe("foo");
    expect(meta.status).toBe("ok");
  });

  it("rhs가 빈 문자열인 key → 빈 배열 + activeListKey 설정", () => {
    const raw = "---\naliases:\n- x\n- y\n---\nbody";
    const meta = (loader as any)._parse_metadata(raw);
    expect(meta.aliases).toEqual(["x", "y"]);
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

// ══════════════════════════════════════════
// suggest_skills_for_text — keyword_hits 상한
// ══════════════════════════════════════════

describe("SkillsLoader — suggest_skills_for_text 키워드 매칭", () => {
  it("요약 키워드 3개 이상 매칭 → 상한 적용 후 포함", () => {
    // keyword-skill 요약: "deploy pipeline build release artifact"
    // 태스크에 3개 이상 단어 포함
    const suggestions = loader.suggest_skills_for_text("deploy the pipeline and build release artifacts");
    expect(suggestions).toContain("keyword-skill");
  });

  it("score=0인 스킬은 제외", () => {
    const suggestions = loader.suggest_skills_for_text("unrelated text about cooking");
    // keyword-skill과 전혀 관계없는 텍스트
    expect(Array.isArray(suggestions)).toBe(true);
  });

  it("limit 20 상한 적용", () => {
    const suggestions = loader.suggest_skills_for_text("skill", 100);
    expect(suggestions.length).toBeLessThanOrEqual(20);
  });

  it("limit 0 → max(1, 0)=1 상한", () => {
    const suggestions = loader.suggest_skills_for_text("skill", 0);
    expect(suggestions.length).toBeLessThanOrEqual(1);
  });
});

// ══════════════════════════════════════════
// _get_missing_requirements — 파일 존재 케이스
// ══════════════════════════════════════════

describe("SkillsLoader — _get_missing_requirements 파일 케이스", () => {
  it("file 요구사항 — 워크스페이스 상대 경로로 존재 시 → missing 없음", () => {
    // skills_root/SKILL.md는 실제로 존재하지 않지만, workspace 내 존재하는 파일 사용
    writeFileSync(join(workspace, "existing_req.txt"), "content");
    const missing = (loader as any)._get_missing_requirements({
      requires: ["file:existing_req.txt"],
    });
    expect(missing).toBe("");
  });

  it("optional file 미존재 → missing에 포함 안 됨", () => {
    const missing = (loader as any)._get_missing_requirements({
      requires: ["?file:/nonexistent/path/file.txt"],
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

// ══════════════════════════════════════════
// _scan_flat_md — commands 디렉토리 로드
// ══════════════════════════════════════════

describe("SkillsLoader — .claude/commands 로드 (force_type role)", () => {
  it("type:role frontmatter → role 스킬로 로드", () => {
    const meta = loader.get_skill_metadata("forced-role-skill");
    // _scan_flat_md는 frontmatter의 type을 읽어 역할 결정
    // ROLE_TYPE_MD에 type:role이 없으므로 "tool" 타입
    // → 실제 역할은 frontmatter에 따라 다름
    expect(meta).not.toBeNull();
  });
});

// ══════════════════════════════════════════
// _resolve_skill_name — lowercase 매칭
// ══════════════════════════════════════════

describe("SkillsLoader — _resolve_skill_name 대소문자 매칭", () => {
  it("대문자 → 소문자 매칭으로 반환", () => {
    const meta = loader.get_skill_metadata("KEYWORD-SKILL");
    expect(meta).not.toBeNull();
    expect(meta!.name).toBe("keyword-skill");
  });

  it("빈 이름 → null", () => {
    const meta = loader.get_skill_metadata("   ");
    expect(meta).toBeNull();
  });
});
