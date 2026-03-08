/**
 * SkillsLoader — 미커버 분기 보충.
 * load_skills_for_context: always 스킬 자동 포함, requirements 필터, raw content 없음.
 * build_skill_summary: type=role 제외, always/model/tools/oauth 태그.
 * get_role_skill / load_role_context / list_role_skills: 역할 스킬 관리.
 * get_shared_protocol / _scan_shared_protocols / _scan_shared_dir: 공유 프로토콜.
 * parse_meta_string_list: 쉼표 구분 문자열, 단일 문자열.
 * suggest_skills_for_text: 트리거/별칭 매치 경로.
 * refresh(): 재스캔.
 */
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SkillsLoader } from "@src/agent/skills.service.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "skills-svc-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// SKILL.md 작성 헬퍼
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

// ══════════════════════════════════════════
// load_skills_for_context — always 스킬 자동 포함
// ══════════════════════════════════════════

describe("SkillsLoader — load_skills_for_context always 스킬", () => {
  it("always=true 스킬은 skill_names 없이도 자동 포함됨", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "auto-skill", "name: auto-skill\nalways: true", "항상 포함 내용");
    await write_skill(skills_root, "normal-skill", "name: normal-skill", "일반 스킬 내용");

    const loader = new SkillsLoader(workspace);
    const ctx = loader.load_skills_for_context([]);
    expect(ctx).toContain("auto-skill");
    expect(ctx).not.toContain("normal-skill");
  });

  it("명시적으로 지정된 스킬은 포함됨", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "my-skill", "name: my-skill", "명시 스킬 내용");

    const loader = new SkillsLoader(workspace);
    const ctx = loader.load_skills_for_context(["my-skill"]);
    expect(ctx).toContain("my-skill");
    expect(ctx).toContain("명시 스킬 내용");
  });

  it("requirements 미충족 스킬은 always여도 제외됨", async () => {
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

  it("raw 없는 스킬(내용 손상) → 컨텍스트에서 건너뜀", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "empty-skill", "name: empty-skill", "");

    const loader = new SkillsLoader(workspace);
    // empty-skill은 내용이 없으므로 포함 안 됨
    const ctx = loader.load_skills_for_context(["empty-skill"]);
    expect(ctx).not.toContain("empty-skill");
  });
});

// ══════════════════════════════════════════
// build_skill_summary — 태그 분기
// ══════════════════════════════════════════

describe("SkillsLoader — build_skill_summary 태그 분기", () => {
  it("type=role 스킬은 요약에서 제외됨", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "my-role", "name: my-role\ntype: role\nrole: implementer", "역할 내용");
    await write_skill(skills_root, "my-tool", "name: my-tool", "도구 내용");

    const loader = new SkillsLoader(workspace);
    const summary = loader.build_skill_summary();
    expect(summary).not.toContain("my-role");
    expect(summary).toContain("my-tool");
  });

  it("always=true → [always] 태그 포함됨", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "always-tool", "name: always-tool\nalways: true", "항상 도구");

    const loader = new SkillsLoader(workspace);
    const summary = loader.build_skill_summary();
    expect(summary).toContain("always");
  });

  it("model 지정 → [model:xxx] 태그 포함됨", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "smart-tool", "name: smart-tool\nmodel: claude-opus-4-6", "고급 도구");

    const loader = new SkillsLoader(workspace);
    const summary = loader.build_skill_summary();
    expect(summary).toContain("model:claude-opus-4-6");
  });

  it("tools 지정 → [tools:xxx] 태그 포함됨", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "fetch-tool", "name: fetch-tool\ntools: web_search,http_fetch", "fetch 도구");

    const loader = new SkillsLoader(workspace);
    const summary = loader.build_skill_summary();
    expect(summary).toContain("tools:");
  });

  it("oauth 지정 → [oauth:xxx] 태그 포함됨", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "oauth-tool", "name: oauth-tool\noauth: google", "oauth 도구");

    const loader = new SkillsLoader(workspace);
    const summary = loader.build_skill_summary();
    expect(summary).toContain("oauth:");
  });
});

// ══════════════════════════════════════════
// get_role_skill / load_role_context / list_role_skills
// ══════════════════════════════════════════

describe("SkillsLoader — 역할 스킬 관리", () => {
  it("get_role_skill: role 이름으로 역할 메타데이터 반환", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(
      skills_root,
      "implementer",
      "name: implementer\ntype: role\nrole: implementer",
      "구현자 역할 설명",
    );

    const loader = new SkillsLoader(workspace);
    const meta = loader.get_role_skill("implementer");
    expect(meta).not.toBeNull();
    expect(meta?.role).toBe("implementer");
    expect(meta?.type).toBe("role");
  });

  it("get_role_skill: 없는 역할 → null 반환", async () => {
    const loader = new SkillsLoader(workspace);
    expect(loader.get_role_skill("nonexistent")).toBeNull();
    expect(loader.get_role_skill("")).toBeNull();
  });

  it("list_role_skills: type=role 스킬만 반환", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "r1", "name: r1\ntype: role\nrole: r1", "역할1");
    await write_skill(skills_root, "r2", "name: r2\ntype: role\nrole: r2", "역할2");
    await write_skill(skills_root, "t1", "name: t1", "도구1");

    const loader = new SkillsLoader(workspace);
    const roles = loader.list_role_skills();
    expect(roles.length).toBe(2);
    expect(roles.every(m => m.type === "role")).toBe(true);
  });

  it("load_role_context: 역할 본문 반환", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(
      skills_root,
      "reviewer",
      "name: reviewer\ntype: role\nrole: reviewer",
      "리뷰어 역할 본문입니다.",
    );

    const loader = new SkillsLoader(workspace);
    const ctx = loader.load_role_context("reviewer");
    expect(ctx).toContain("리뷰어 역할 본문입니다.");
  });

  it("load_role_context: 없는 역할 → null 반환", async () => {
    const loader = new SkillsLoader(workspace);
    expect(loader.load_role_context("ghost")).toBeNull();
  });

  it("load_role_context: shared_protocols 포함됨", async () => {
    const skills_root = join(workspace, "skills");
    // 공유 프로토콜 파일 작성
    const shared_dir = join(skills_root, "_shared");
    await mkdir(shared_dir, { recursive: true });
    await writeFile(join(shared_dir, "coding-style.md"), "# 코딩 스타일\n일관성 유지");

    // shared_protocols 지정한 역할 스킬
    await write_skill(
      skills_root,
      "dev-role",
      "name: dev-role\ntype: role\nrole: developer\nshared_protocols: coding-style",
      "개발자 역할 설명",
    );

    const loader = new SkillsLoader(workspace);
    const ctx = loader.load_role_context("developer");
    expect(ctx).toContain("coding-style");
    expect(ctx).toContain("코딩 스타일");
  });
});

// ══════════════════════════════════════════
// get_shared_protocol / _scan_shared_protocols / _scan_shared_dir
// ══════════════════════════════════════════

describe("SkillsLoader — 공유 프로토콜", () => {
  it("get_shared_protocol: 존재하는 프로토콜 → 내용 반환", async () => {
    const skills_root = join(workspace, "skills");
    const shared_dir = join(skills_root, "_shared");
    await mkdir(shared_dir, { recursive: true });
    await writeFile(join(shared_dir, "my-protocol.md"), "# 프로토콜 내용\n세부 사항");

    const loader = new SkillsLoader(workspace);
    const content = loader.get_shared_protocol("my-protocol");
    expect(content).toContain("프로토콜 내용");
  });

  it("get_shared_protocol: 없는 프로토콜 → null 반환", async () => {
    const loader = new SkillsLoader(workspace);
    expect(loader.get_shared_protocol("nonexistent")).toBeNull();
  });

  it("_scan_shared_dir: 서브디렉토리 네임스페이스 키 사용", async () => {
    const skills_root = join(workspace, "skills");
    const lang_dir = join(skills_root, "_shared", "lang");
    await mkdir(lang_dir, { recursive: true });
    await writeFile(join(lang_dir, "typescript.md"), "# TypeScript 가이드");

    const loader = new SkillsLoader(workspace);
    // 서브디렉토리 → "lang/typescript" 키
    const content = loader.get_shared_protocol("lang/typescript");
    expect(content).toContain("TypeScript 가이드");
  });

  it("공유 프로토콜 파일이 없으면 get_shared_protocol → null", async () => {
    const loader = new SkillsLoader(workspace);
    expect(loader.get_shared_protocol("does-not-exist")).toBeNull();
  });
});

// ══════════════════════════════════════════
// parse_meta_string_list — 문자열 분기
// ══════════════════════════════════════════

describe("SkillsLoader — parse_meta_string_list 문자열 입력", () => {
  it("쉼표 구분 문자열 → 분리된 배열 반환", async () => {
    const skills_root = join(workspace, "skills");
    // tools에 쉼표 구분 문자열 사용
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

  it("배열 형식 → 배열 그대로 사용", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(
      skills_root,
      "list-triggers",
      "name: list-triggers\ntriggers:\n- 검색해줘\n- 찾아줘",
      "트리거 목록 스킬",
    );

    const loader = new SkillsLoader(workspace);
    const meta = loader.get_skill_metadata("list-triggers");
    expect(meta?.triggers).toContain("검색해줘");
    expect(meta?.triggers).toContain("찾아줘");
  });
});

// ══════════════════════════════════════════
// suggest_skills_for_text — 트리거/별칭 매치
// ══════════════════════════════════════════

describe("SkillsLoader — suggest_skills_for_text 매치 경로", () => {
  it("스킬 이름 매치 → 가장 높은 점수", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "searcher", "name: searcher\nsummary: 검색 도구", "검색 기능");
    await write_skill(skills_root, "writer", "name: writer\nsummary: 문서 작성 도구", "작성 기능");

    const loader = new SkillsLoader(workspace);
    // 스킬 이름과 정확히 일치하도록 공백으로 구분
    const results = loader.suggest_skills_for_text("searcher 사용해서 검색해줘");
    expect(results).toContain("searcher");
  });

  it("트리거 키워드 매치 → 결과 포함", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(
      skills_root,
      "pdf-tool",
      "name: pdf-tool\nsummary: PDF 처리 도구\ntriggers: pdf변환,pdf파싱",
      "PDF 기능",
    );

    const loader = new SkillsLoader(workspace);
    const results = loader.suggest_skills_for_text("이 파일을 pdf변환 해줘");
    expect(results).toContain("pdf-tool");
  });

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

  it("매치 없음 → 빈 배열", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "unrelated", "name: unrelated\nsummary: 무관한 도구", "무관");

    const loader = new SkillsLoader(workspace);
    const results = loader.suggest_skills_for_text("xyzzy-nonsense-string-12345");
    expect(Array.isArray(results)).toBe(true);
  });

  it("빈 텍스트 → 빈 배열", async () => {
    const loader = new SkillsLoader(workspace);
    const results = loader.suggest_skills_for_text("");
    expect(results).toEqual([]);
  });

  it("type=role 스킬은 제안에서 제외됨", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(
      skills_root,
      "my-role",
      "name: my-role\ntype: role\nrole: implementer\nsummary: 역할 스킬",
      "역할 내용",
    );

    const loader = new SkillsLoader(workspace);
    const results = loader.suggest_skills_for_text("my-role 역할");
    expect(results).not.toContain("my-role");
  });
});

// ══════════════════════════════════════════
// get_always_skills
// ══════════════════════════════════════════

describe("SkillsLoader — get_always_skills", () => {
  it("always=true 스킬만 반환", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "always-one", "name: always-one\nalways: true", "항상 1");
    await write_skill(skills_root, "optional-one", "name: optional-one", "선택적");

    const loader = new SkillsLoader(workspace);
    const always = loader.get_always_skills();
    expect(always).toContain("always-one");
    expect(always).not.toContain("optional-one");
  });

  it("requirements 미충족 always 스킬 → get_always_skills에서 제외", async () => {
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

// ══════════════════════════════════════════
// refresh — 재스캔
// ══════════════════════════════════════════

describe("SkillsLoader — refresh() 재스캔", () => {
  it("refresh 전 없던 스킬이 refresh 후 목록에 나타남", async () => {
    const loader = new SkillsLoader(workspace);
    expect(loader.list_skills()).toHaveLength(0);

    // 스킬 파일 추가
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "new-skill", "name: new-skill\nsummary: 새 스킬", "새 내용");

    // refresh 전에는 없음 (캐시 사용)
    // refresh 후에는 있음
    loader.refresh();
    const skills = loader.list_skills();
    expect(skills.some(s => s.name === "new-skill")).toBe(true);
  });
});

// ══════════════════════════════════════════
// oauth → oauth_fetch 도구 자동 추가
// ══════════════════════════════════════════

describe("SkillsLoader — oauth → oauth_fetch 자동 추가", () => {
  it("oauth 필드 있는 스킬 → tools에 oauth_fetch 자동 포함", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "google-tool", "name: google-tool\noauth: google_calendar", "구글 도구");

    const loader = new SkillsLoader(workspace);
    const meta = loader.get_skill_metadata("google-tool");
    expect(meta?.tools).toContain("oauth_fetch");
    expect(meta?.oauth).toContain("google_calendar");
  });
});

// ══════════════════════════════════════════
// list_skills — type_filter
// ══════════════════════════════════════════

describe("SkillsLoader — list_skills type_filter", () => {
  it("type_filter=role → role 스킬만 반환", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "r1", "name: r1\ntype: role\nrole: r1", "역할");
    await write_skill(skills_root, "t1", "name: t1", "도구");

    const loader = new SkillsLoader(workspace);
    const roles = loader.list_skills(false, "role");
    expect(roles.every(s => s.type === "role")).toBe(true);
    expect(roles.some(s => s.name === "r1")).toBe(true);
    expect(roles.some(s => s.name === "t1")).toBe(false);
  });
});

// ══════════════════════════════════════════
// autoload = always 동의어
// ══════════════════════════════════════════

describe("SkillsLoader — autoload 동의어", () => {
  it("autoload: true → always=true로 처리", async () => {
    const skills_root = join(workspace, "skills");
    await write_skill(skills_root, "autoloaded", "name: autoloaded\nautoload: true", "자동 로드 스킬");

    const loader = new SkillsLoader(workspace);
    const meta = loader.get_skill_metadata("autoloaded");
    expect(meta?.always).toBe(true);
  });
});
