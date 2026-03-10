/**
 * 소규모 미커버 분기 모음 (cov3):
 * - classifier.ts L115: is_followup_inquiry — !history?.length → return false
 * - completion-checker.ts L54: skill.always=true → continue (skip always 스킬)
 * - skill-index.ts L139: aliases 매칭 → bonus +10
 */
import { describe, it, expect } from "vitest";

// ── classifier L115 ──────────────────────────────────────────────────────────

import { fast_classify } from "@src/orchestration/classifier.js";
import type { ClassifierContext } from "@src/orchestration/classifier.js";

function ctx(overrides: Partial<ClassifierContext> = {}): ClassifierContext {
  return { ...overrides };
}

describe("classifier — is_followup_inquiry L115: !history?.length → false", () => {
  it("active_tasks 있고 history 없음(빈 배열) → is_followup_inquiry L115 return false → inquiry 미반환", () => {
    // is_inquiry_question: "잠깐" 은 inquiry 키워드 아님 → false
    // is_followup_inquiry(tokens, []) → !history?.length = !0 = true → L115 return false
    const result = fast_classify("잠깐", ctx({
      active_tasks: [{ task_id: "t1", status: "running" } as any],
      recent_history: [],
    }));
    // inquiry 조건 모두 false → inquiry 미반환
    expect(result.mode).not.toBe("inquiry");
  });

  it("active_tasks 있고 history=undefined → is_followup_inquiry L115 !history?.length → false", () => {
    const result = fast_classify("잠깐만요", ctx({
      active_tasks: [{ task_id: "t2", status: "running" } as any],
      recent_history: undefined,
    }));
    expect(result.mode).not.toBe("inquiry");
  });
});

// ── completion-checker L54 ───────────────────────────────────────────────────

import { generate_completion_checks } from "@src/orchestration/completion-checker.js";
import type { SkillMetadata } from "@src/agent/skills.types.js";

function make_skill(overrides: Partial<SkillMetadata> & { name: string }): SkillMetadata {
  return {
    name: overrides.name,
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
    checks: [],
    project_docs: false,
    ...overrides,
  };
}

describe("completion-checker L54: skill.always=true → continue (always 스킬 체크 제외)", () => {
  it("always=true 스킬의 checks[] 무시되고 다음 스킬 checks[] 포함됨", () => {
    const always_skill = make_skill({ name: "always-tool", always: true, checks: ["always 체크 질문?"] });
    const normal_skill = make_skill({ name: "normal", always: false, checks: ["일반 체크 질문?"] });

    const result = generate_completion_checks([], [always_skill, normal_skill], 0, true);

    // always_skill.checks는 L54 continue로 제외됨
    expect(result.questions).not.toContain("always 체크 질문?");
    // normal_skill.checks는 포함됨
    expect(result.questions).toContain("일반 체크 질문?");
  });

  it("always=true 스킬만 있을 때 → checks 없음", () => {
    const always_skill = make_skill({ name: "sandbox", always: true, checks: ["샌드박스 체크?"] });
    const result = generate_completion_checks([], [always_skill], 0, true);
    expect(result.questions).toHaveLength(0);
  });
});

// ── skill-index L139 ─────────────────────────────────────────────────────────

import { SkillIndex } from "@src/orchestration/skill-index.js";

describe("skill-index L139: aliases 직접 매칭 → bonus +10", () => {
  it("alias가 task에 포함되면 L139 bonus += 10, select 결과에 반영", () => {
    const index = new SkillIndex();
    index.build([
      make_skill({
        name: "pdf-maker",
        summary: "문서 생성 도구",
        aliases: ["pdf", "리포트"],  // aliases 있음 → L139 경로
        triggers: [],
        intents: [],
      }),
      make_skill({
        name: "other-tool",
        summary: "다른 도구",
        aliases: [],
        triggers: [],
        intents: [],
      }),
    ]);

    // "pdf 만들어줘" → alias "pdf"가 task에 포함됨 → L139 bonus += 10
    const results = index.select("pdf 만들어줘");
    // pdf-maker가 alias 매칭으로 포함됨
    expect(results).toContain("pdf-maker");
  });
});
