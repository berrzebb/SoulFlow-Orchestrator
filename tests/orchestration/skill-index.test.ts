import { describe, it, expect, beforeEach } from "vitest";
import { SkillIndex } from "../../src/orchestration/skill-index.js";
import type { SkillMetadata } from "../../src/agent/skills.types.js";

function make_skill(overrides: Partial<SkillMetadata> & { name: string }): SkillMetadata {
  return {
    path: `/skills/${overrides.name}/SKILL.md`,
    source: "builtin_skills",
    type: "tool",
    always: false,
    summary: overrides.summary || `${overrides.name} skill`,
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

describe("SkillIndex", () => {
  let index: SkillIndex;
  const skills: SkillMetadata[] = [
    make_skill({
      name: "file-maker",
      summary: "PDF, DOCX, PPTX 문서 생성",
      triggers: ["PDF", "보고서", "문서 만들기"],
      intents: ["generate_document"],
      file_patterns: ["*.pdf", "*.docx", "*.pptx"],
    }),
    make_skill({
      name: "sandbox",
      summary: "파이썬 코드 실행 샌드박스",
      triggers: ["python", "코드 실행", "분석"],
      intents: ["execute_code", "analyze_data"],
      code_patterns: ["python", "pandas", "numpy"],
    }),
    make_skill({
      name: "github",
      summary: "GitHub 이슈, PR, 커밋 관리",
      triggers: ["github", "commit", "PR"],
      intents: ["version_control"],
      code_patterns: ["git"],
    }),
    make_skill({
      name: "web-search",
      summary: "웹 검색",
      triggers: ["검색", "search"],
      intents: ["search_web"],
    }),
  ];

  beforeEach(() => {
    index = new SkillIndex();
    index.build(skills);
  });

  it("is_built가 build() 후 true", () => {
    expect(index.is_built).toBe(true);
  });

  it("빌드 전 select() → 빈 배열", () => {
    const empty = new SkillIndex();
    expect(empty.select("PDF 보고서")).toEqual([]);
  });

  it("PDF 보고서 만들어줘 → file-maker 상위 매칭", () => {
    const results = index.select("PDF 보고서 만들어줘", {}, 3);
    expect(results[0]).toBe("file-maker");
  });

  it("파이썬으로 데이터 분석 → sandbox 상위 매칭", () => {
    const results = index.select("파이썬으로 데이터 분석해줘", {}, 3);
    expect(results[0]).toBe("sandbox");
  });

  it("file_hints로 PDF 확장자 전달 시 file-maker 보너스", () => {
    const results = index.select("문서 작업", { file_hints: [".pdf"] }, 3);
    expect(results).toContain("file-maker");
  });

  it("code_hints로 python 전달 시 sandbox 보너스", () => {
    const results = index.select("분석 작업", { code_hints: ["python"] }, 3);
    expect(results).toContain("sandbox");
  });

  it("커밋 PR 이슈 → github 매칭", () => {
    const results = index.select("커밋하고 PR 올려줘", {}, 3);
    expect(results).toContain("github");
  });

  it("검색 → web-search 매칭", () => {
    const results = index.select("구글에서 검색해줘", {}, 3);
    expect(results).toContain("web-search");
  });

  it("limit 준수", () => {
    const results = index.select("문서 코드 검색 커밋", {}, 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("role 타입 스킬은 인덱싱 제외", () => {
    const role_skill = make_skill({ name: "implementer-role", type: "role", triggers: ["문서"] });
    index.build([...skills, role_skill]);
    const results = index.select("문서", {}, 10);
    expect(results).not.toContain("implementer-role");
  });

  it("빈 task → 빈 배열 (FTS5 쿼리 길이 미달)", () => {
    const results = index.select("", {}, 6);
    expect(results).toEqual([]);
  });

  it("rebuild 후 새 스킬 반영", () => {
    const new_skill = make_skill({
      name: "slack-tool",
      summary: "Slack 메시지 전송",
      triggers: ["slack", "메시지 전송"],
      intents: ["send_message"],
    });
    index.build([...skills, new_skill]);
    const results = index.select("slack에 메시지 보내줘", {}, 3);
    expect(results).toContain("slack-tool");
  });
});
