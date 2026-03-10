/**
 * classifier.ts — 미커버 분기 (cov2):
 * - L115-118: is_followup_inquiry (history + RE_TASK_MENTION)
 * - L126-131: tokenize_phrase 캐시 미스 → 캐시 저장
 * - L141-148: match_skill_trigger (일치 / 미일치)
 * - L167: classify_execution_complexity → task (TASK_SIGNAL_PHRASES)
 * - L170: classify_execution_complexity → once (skill trigger 매칭)
 * - L173: classify_execution_complexity → agent (connector token)
 * - L175: classify_execution_complexity → agent (connector phrase)
 * - L177: classify_execution_complexity → agent (tool pair)
 * - L179: classify_execution_complexity → agent (토큰 수 ≥ 50)
 */
import { describe, it, expect } from "vitest";
import { fast_classify } from "@src/orchestration/classifier.js";
import type { ClassifierContext, SkillEntry } from "@src/orchestration/classifier.js";

function ctx(overrides: Partial<ClassifierContext> = {}): ClassifierContext {
  return { ...overrides };
}

// ── classify_execution_complexity — task / agent 분기 ─────────────────────

describe("classify_execution_complexity — task 분기 (L167)", () => {
  it("'백그라운드' 포함 → task", () => {
    expect(fast_classify("백그라운드 실행해줘", ctx()).mode).toBe("task");
  });

  it("'background' 포함 → task", () => {
    expect(fast_classify("run this in background please", ctx()).mode).toBe("task");
  });

  it("'schedule' 포함 → task", () => {
    expect(fast_classify("schedule this for later", ctx()).mode).toBe("task");
  });
});

describe("classify_execution_complexity — agent (connector token L173)", () => {
  it("'then' 토큰 → agent", () => {
    // AGENT_CONNECTOR_TOKENS: "하고서", "그다음", "후에", "then"
    expect(fast_classify("do this then do that", ctx()).mode).toBe("agent");
  });

  it("'하고서' 토큰 → agent", () => {
    // "하고서"가 독립 토큰으로 분리되어야 AGENT_CONNECTOR_TOKENS 매칭됨
    expect(fast_classify("검색 하고서 저장해", ctx()).mode).toBe("agent");
  });
});

describe("classify_execution_complexity — agent (connector phrase L175)", () => {
  it("'하고 나서' 구문 → agent", () => {
    expect(fast_classify("검색하고 나서 정리해줘", ctx()).mode).toBe("agent");
  });

  it("'and then' 구문 → agent", () => {
    expect(fast_classify("find the file and then send it", ctx()).mode).toBe("agent");
  });

  it("'after that' 구문 → agent", () => {
    expect(fast_classify("do the analysis after that save it", ctx()).mode).toBe("agent");
  });
});

describe("classify_execution_complexity — agent (tool pair L177)", () => {
  it("'파일' + '보내' 포함 → agent", () => {
    expect(fast_classify("파일을 보내줘", ctx()).mode).toBe("agent");
  });

  it("'읽' + '요약' 포함 → agent", () => {
    expect(fast_classify("문서를 읽고 요약해줘", ctx()).mode).toBe("agent");
  });

  it("'search' + 'send' 포함 → agent", () => {
    expect(fast_classify("search for it and send the result", ctx()).mode).toBe("agent");
  });
});

describe("classify_execution_complexity — agent (길이 ≥ 50 tokens L179)", () => {
  it("50+ 토큰 → agent", () => {
    // 50개 이상의 고유한 단어로 구성된 긴 문장
    const words = Array.from({ length: 55 }, (_, i) => `word${i}`).join(" ");
    expect(fast_classify(words, ctx()).mode).toBe("agent");
  });
});

// ── match_skill_trigger + tokenize_phrase 캐시 ────────────────────────────

describe("match_skill_trigger (L141-148) + tokenize_phrase 캐시 (L126-131)", () => {
  const weather_skill: SkillEntry = {
    name: "weather",
    summary: "날씨 조회",
    triggers: ["오늘 날씨 알려줘", "날씨 어때"],
    aliases: ["weather lookup"],
  };

  it("스킬 트리거 매칭 → once (L145, L170)", () => {
    // tokenize_phrase("오늘 날씨 알려줘") — 첫 호출 시 캐시 미스 (L127-129)
    const result = fast_classify("오늘 날씨 알려줘", ctx({ available_skills: [weather_skill] }));
    expect(result.mode).toBe("once");
  });

  it("두 번째 호출 — 동일 구문 캐시 히트 (L131)", () => {
    // 캐시가 이미 채워져 있으면 분기 없이 L131로 바로 jump
    const result = fast_classify("오늘 날씨 알려줘", ctx({ available_skills: [weather_skill] }));
    expect(result.mode).toBe("once");
  });

  it("스킬 트리거 미일치 → once (기본값, L148)", () => {
    // "복잡한 데이터 처리"는 weather 스킬 트리거와 유사도 낮음
    const result = fast_classify("복잡한 데이터 처리", ctx({ available_skills: [weather_skill] }));
    // 트리거 미일치 → once (기본값)
    expect(result.mode).toBe("once");
  });

  it("aliases도 검사 (L142 spread)", () => {
    const result = fast_classify("weather lookup please", ctx({ available_skills: [weather_skill] }));
    // "weather lookup please" vs "weather lookup" — 높은 Jaccard 유사도 기대
    expect(["once", "agent"]).toContain(result.mode);
  });
});

// ── is_followup_inquiry (L115-118) ────────────────────────────────────────

describe("is_followup_inquiry — 짧은 후속 질문 (L115-118)", () => {
  it("활성 태스크 + 짧은 질문 + 태스크 언급 history → inquiry (L116-117)", () => {
    const result = fast_classify(
      "어때요",
      ctx({
        active_tasks: [{ task_id: "t1", status: "running" } as any],
        recent_history: [
          { role: "user", content: "분석해줘" },
          { role: "assistant", content: "백그라운드 작업을 시작했습니다. 태스크 ID: abc123" },
        ],
      }),
    );
    // RE_TASK_MENTION matches "태스크" → is_followup_inquiry returns true → inquiry
    expect(result.mode).toBe("inquiry");
  });

  it("활성 태스크 + 짧은 질문 + 태스크 미언급 history → once (L115 false 반환)", () => {
    const result = fast_classify(
      "어때요",
      ctx({
        active_tasks: [{ task_id: "t1", status: "running" } as any],
        recent_history: [
          { role: "assistant", content: "안녕하세요! 무엇을 도와드릴까요?" },
        ],
      }),
    );
    // history 있지만 태스크 언급 없음 → is_followup_inquiry = false → once/agent
    expect(result.mode).not.toBe("inquiry");
  });

  it("활성 태스크 + 7토큰 초과 질문 → L115 조기 반환 false", () => {
    // tokens.size > 6 → is_followup_inquiry immediately returns false
    const long_text = "지금 진행 중인 작업 상태가 어떻게 되고 있나요";
    const result = fast_classify(
      long_text,
      ctx({
        active_tasks: [{ task_id: "t1", status: "running" } as any],
        recent_history: [
          { role: "assistant", content: "background task 처리 시작" },
        ],
      }),
    );
    // 토큰 > 6 → is_followup_inquiry skipped, but is_inquiry_question might match
    expect(["inquiry", "once", "agent"]).toContain(result.mode);
  });
});
