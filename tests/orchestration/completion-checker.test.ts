import { describe, it, expect } from "vitest";
import { generate_completion_checks, format_follow_up } from "../../src/orchestration/completion-checker.js";
import type { SkillMetadata } from "../../src/agent/skills.types.js";

function make_skill(checks: string[], name = "test"): SkillMetadata {
  return {
    name,
    path: "",
    source: "builtin_skills",
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
    checks,
    project_docs: false,
  };
}

describe("generate_completion_checks", () => {
  it("스킬 checks[]가 우선 포함", () => {
    const skill = make_skill(["파일이 정상인지 확인했나요?", "한글 폰트 깨짐 없나요?"]);
    const result = generate_completion_checks([], [skill], 0);
    expect(result.questions).toContain("파일이 정상인지 확인했나요?");
    expect(result.questions).toContain("한글 폰트 깨짐 없나요?");
    expect(result.has_checks).toBe(true);
  });

  it("write_file 사용 시 파일 내용 체크 질문 추가", () => {
    const result = generate_completion_checks(["write_file"], [], 0, true);
    expect(result.questions).toContain("변경된 파일의 내용이 의도와 일치하나요?");
  });

  it("exec/bash 사용 시 실행 결과 체크 질문 추가", () => {
    const result = generate_completion_checks(["bash"], [], 0, true);
    expect(result.questions).toContain("실행 결과에 에러가 없었나요?");
  });

  it("web_search 사용 시 출처 체크 질문 추가", () => {
    const result = generate_completion_checks(["web_search"], [], 0, true);
    expect(result.questions).toContain("검색 결과의 출처가 신뢰할 수 있나요?");
  });

  it("oauth_fetch 사용 시 민감 정보 체크 추가", () => {
    const result = generate_completion_checks(["oauth_fetch"], [], 0, true);
    expect(result.questions).toContain("민감한 정보가 노출되지 않았나요?");
  });

  it("tool_calls_count > 10 시 전체 검토 체크 추가", () => {
    const result = generate_completion_checks([], [], 11, true);
    expect(result.questions).toContain("최종 결과물을 전체적으로 검토했나요?");
  });

  it("최대 5개 체크 질문만 생성", () => {
    const skill = make_skill([
      "체크 1", "체크 2", "체크 3", "체크 4", "체크 5", "체크 6",
    ]);
    const result = generate_completion_checks(["write_file", "bash", "web_search"], [skill], 15, true);
    expect(result.questions.length).toBeLessThanOrEqual(5);
  });

  it("중복 질문 제거", () => {
    const skill1 = make_skill(["파일이 정상인지 확인했나요?"]);
    const skill2 = make_skill(["파일이 정상인지 확인했나요?"]);
    const result = generate_completion_checks([], [skill1, skill2], 0);
    const count = result.questions.filter((q) => q === "파일이 정상인지 확인했나요?").length;
    expect(count).toBe(1);
  });

  it("도구 없고 스킬 없으면 has_checks false", () => {
    const result = generate_completion_checks([], [], 0);
    expect(result.has_checks).toBe(false);
    expect(result.questions).toEqual([]);
  });

  it("스킬 checks[]가 동적 체크보다 우선", () => {
    const checks = Array.from({ length: 5 }, (_, i) => `스킬 체크 ${i + 1}`);
    const skill = make_skill(checks);
    const result = generate_completion_checks(["write_file", "bash"], [skill], 15);
    // 스킬 체크 5개로 꽉 차면 동적 체크는 들어오지 않음
    expect(result.questions.every((q) => q.startsWith("스킬 체크"))).toBe(true);
  });
});

describe("format_follow_up", () => {
  it("빈 배열이면 빈 문자열", () => {
    expect(format_follow_up([])).toBe("");
  });

  it("질문 목록을 체크리스트 형식으로 포맷", () => {
    const result = format_follow_up(["체크 1", "체크 2"]);
    expect(result).toContain("📋 **완료 체크리스트**");
    expect(result).toContain("- [ ] 체크 1");
    expect(result).toContain("- [ ] 체크 2");
  });
});
