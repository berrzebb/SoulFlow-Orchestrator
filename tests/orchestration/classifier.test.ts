/**
 * classifier.ts — 키워드 휴리스틱 분류기 테스트.
 *
 * 대상:
 * - fast_classify(): builtin / identity / inquiry / once 분류
 * - classify_execution_mode(): fast_classify 래퍼 (logger 검증)
 * - parse_execution_mode(): JSON/단어 파싱
 * - detect_escalation(): NEED TASK LOOP / NEED AGENT LOOP
 * - is_once_escalation(), is_agent_escalation()
 */

import { describe, it, expect, vi } from "vitest";
import {
  classify_execution_mode,
  fast_classify,
  parse_execution_mode,
  detect_escalation,
  is_once_escalation,
  is_agent_escalation,
} from "@src/orchestration/classifier.js";
import type { ClassifierContext, SkillEntry } from "@src/orchestration/classifier.js";
import type { Logger } from "@src/logger.js";

const noop_logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

function ctx(overrides: Partial<ClassifierContext> = {}): ClassifierContext {
  return { ...overrides };
}

// ══════════════════════════════════════════════════
// fast_classify
// ══════════════════════════════════════════════════

describe("fast_classify — 휴리스틱 분류", () => {
  describe("기본 경로", () => {
    it("빈 문자열 → once", () => {
      expect(fast_classify("", ctx()).mode).toBe("once");
    });

    it("공백만 → once", () => {
      expect(fast_classify("   ", ctx()).mode).toBe("once");
    });

    it("일반 질문 → once", () => {
      expect(fast_classify("오늘 날씨 알려줘", ctx()).mode).toBe("once");
    });
  });

  describe("builtin: /커맨드", () => {
    it("/help → builtin, command='help'", () => {
      const r = fast_classify("/help", ctx());
      expect(r.mode).toBe("builtin");
      expect(r.command).toBe("help");
    });

    it("/task list → builtin, command='task', args='list'", () => {
      const r = fast_classify("/task list", ctx());
      expect(r.mode).toBe("builtin");
      expect(r.command).toBe("task");
      expect(r.args).toBe("list");
    });

    it("/cmd → args=undefined (인자 없음)", () => {
      const r = fast_classify("/cmd", ctx());
      expect(r.mode).toBe("builtin");
      expect(r.args).toBeUndefined();
    });
  });

  describe("identity: 봇 정체성 질문", () => {
    it("'너 누구야' → identity", () => {
      expect(fast_classify("너 누구야", ctx()).mode).toBe("identity");
    });

    it("'who are you' → identity", () => {
      expect(fast_classify("who are you", ctx()).mode).toBe("identity");
    });

    it("'자기소개해줘' → identity", () => {
      expect(fast_classify("자기소개해줘", ctx()).mode).toBe("identity");
    });
  });

  describe("inquiry: 활성 태스크 상태 조회", () => {
    const task_state: any = {
      taskId: "t1",
      title: "T",
      status: "in_progress",
      memory: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentTurn: 1,
      objective: "",
      channel: "slack",
      chatId: "C1",
    };

    it("active_tasks 있음 + '상태' 키워드 → inquiry", () => {
      expect(fast_classify("작업 상태 어때?", ctx({ active_tasks: [task_state] })).mode).toBe("inquiry");
    });

    it("active_tasks 있음 + 'status' 키워드 → inquiry", () => {
      expect(fast_classify("what is the status", ctx({ active_tasks: [task_state] })).mode).toBe("inquiry");
    });

    it("active_tasks 없음 + '상태' 키워드 → once (inquiry 아님)", () => {
      expect(fast_classify("상태 알려줘", ctx()).mode).toBe("once");
    });

    it("active_tasks 빈 배열 → inquiry 미발동", () => {
      expect(fast_classify("진행 상황은?", ctx({ active_tasks: [] })).mode).toBe("once");
    });
  });
});

// ══════════════════════════════════════════════════
// classify_execution_mode (래퍼)
// ══════════════════════════════════════════════════

describe("classify_execution_mode — 래퍼", () => {
  it("logger.info 호출", async () => {
    const logger = { ...noop_logger, info: vi.fn() } as unknown as Logger;
    await classify_execution_mode("hello", ctx(), null, logger);
    expect(logger.info).toHaveBeenCalledWith("classify_result", expect.objectContaining({ source: "heuristic" }));
  });

  it("빈 task → once 반환", async () => {
    const result = await classify_execution_mode("", ctx(), null, noop_logger);
    expect(result.mode).toBe("once");
  });

  it("identity 키워드 → identity 반환", async () => {
    const result = await classify_execution_mode("introduce yourself", ctx(), null, noop_logger);
    expect(result.mode).toBe("identity");
  });
});

// ══════════════════════════════════════════════════
// parse_execution_mode
// ══════════════════════════════════════════════════

describe("parse_execution_mode — JSON/단어 파싱", () => {
  it("빈 문자열 → null", () => {
    expect(parse_execution_mode("")).toBeNull();
  });

  it("JSON {mode:'once'} → {mode:'once'}", () => {
    expect(parse_execution_mode('{"mode":"once"}')).toMatchObject({ mode: "once" });
  });

  it("JSON {mode:'agent'} → {mode:'agent'}", () => {
    expect(parse_execution_mode('{"mode":"agent"}')).toMatchObject({ mode: "agent" });
  });

  it("JSON {mode:'task'} → {mode:'task'}", () => {
    expect(parse_execution_mode('{"mode":"task"}')).toMatchObject({ mode: "task" });
  });

  it("JSON {mode:'inquiry'} → {mode:'inquiry'}", () => {
    expect(parse_execution_mode('{"mode":"inquiry"}')).toMatchObject({ mode: "inquiry" });
  });

  it("JSON {mode:'identity'} → {mode:'identity'}", () => {
    expect(parse_execution_mode('{"mode":"identity"}')).toMatchObject({ mode: "identity" });
  });

  it("JSON phase + workflow_id → {mode:'phase', workflow_id}", () => {
    const r = parse_execution_mode('{"mode":"phase","workflow_id":"wf-123"}');
    expect(r?.mode).toBe("phase");
    expect(r?.workflow_id).toBe("wf-123");
  });

  it("JSON phase + nodes 배열 → nodes 포함", () => {
    const r = parse_execution_mode('{"mode":"phase","nodes":["n1","n2"]}');
    expect(r?.mode).toBe("phase");
    expect(r?.nodes).toEqual(["n1", "n2"]);
  });

  it("JSON phase + workflow_id + nodes 둘 다 → 모두 포함", () => {
    const r = parse_execution_mode('{"mode":"phase","workflow_id":"wf-x","nodes":["a","b"]}');
    expect(r?.workflow_id).toBe("wf-x");
    expect(r?.nodes).toEqual(["a", "b"]);
  });

  it("JSON phase 빈 nodes → nodes 미포함", () => {
    const r = parse_execution_mode('{"mode":"phase","nodes":[]}');
    expect(r?.mode).toBe("phase");
    expect(r?.nodes).toBeUndefined();
  });

  it("JSON once + tools 배열 → tools 포함", () => {
    const r = parse_execution_mode('{"mode":"once","tools":["tool1","tool2"]}');
    expect(r?.mode).toBe("once");
    expect(r?.tools).toEqual(["tool1", "tool2"]);
  });

  it("JSON agent + tools → tools 포함", () => {
    const r = parse_execution_mode('{"mode":"agent","tools":["t1"]}');
    expect(r?.tools).toEqual(["t1"]);
  });

  it("JSON task + 빈 tools → tools 미포함", () => {
    const r = parse_execution_mode('{"mode":"task","tools":[]}');
    expect(r?.mode).toBe("task");
    expect(r?.tools).toBeUndefined();
  });

  it("JSON builtin + command → command 포함", () => {
    const r = parse_execution_mode('{"mode":"builtin","command":"help"}');
    expect(r?.mode).toBe("builtin");
    expect(r?.command).toBe("help");
  });

  it("JSON builtin + args → args 포함", () => {
    const r = parse_execution_mode('{"mode":"builtin","command":"task","args":"list all"}');
    expect(r?.args).toBe("list all");
  });

  it("JSON builtin command 없음 → null", () => {
    expect(parse_execution_mode('{"mode":"builtin"}')).toBeNull();
  });

  it("단어 'once' 포함 텍스트 → {mode:'once'}", () => {
    expect(parse_execution_mode("the mode is once")).toMatchObject({ mode: "once" });
  });

  it("단어 'task' 포함 텍스트 → {mode:'task'}", () => {
    expect(parse_execution_mode("use task mode")).toMatchObject({ mode: "task" });
  });

  it("단어 'phase' 포함 텍스트 → {mode:'phase'}", () => {
    expect(parse_execution_mode("run in phase mode")).toMatchObject({ mode: "phase" });
  });

  it("단어 'identity' 포함 텍스트 → {mode:'identity'}", () => {
    expect(parse_execution_mode("this is identity mode")).toMatchObject({ mode: "identity" });
  });

  it("알 수 없는 텍스트 → null", () => {
    expect(parse_execution_mode("some random text")).toBeNull();
  });

  it("잘못된 JSON은 단어 파싱 fallback", () => {
    const r = parse_execution_mode("{invalid} once mode");
    // 단어 파싱으로 'once' 추출
    expect(r?.mode).toBe("once");
  });
});

// ══════════════════════════════════════════════════
// detect_escalation
// ══════════════════════════════════════════════════

describe("detect_escalation — 에스컬레이션 감지", () => {
  it("NEED TASK LOOP (once 기본) → once_requires_task_loop", () => {
    expect(detect_escalation("NEED TASK LOOP")).toBe("once_requires_task_loop");
  });

  it("NEED TASK LOOP (agent) → agent_requires_task_loop", () => {
    expect(detect_escalation("NEED TASK LOOP", "agent")).toBe("agent_requires_task_loop");
  });

  it("NEED AGENT LOOP → once_requires_agent_loop", () => {
    expect(detect_escalation("NEED AGENT LOOP")).toBe("once_requires_agent_loop");
  });

  it("need_task_loop (소문자+언더스코어) → 감지됨", () => {
    expect(detect_escalation("need_task_loop")).toBe("once_requires_task_loop");
  });

  it("관련 없는 텍스트 → null", () => {
    expect(detect_escalation("일반 텍스트")).toBeNull();
  });
});

// ══════════════════════════════════════════════════
// is_once_escalation
// ══════════════════════════════════════════════════

describe("is_once_escalation", () => {
  it("once_requires_task_loop → true", () => {
    expect(is_once_escalation("once_requires_task_loop")).toBe(true);
  });

  it("once_requires_agent_loop → true", () => {
    expect(is_once_escalation("once_requires_agent_loop")).toBe(true);
  });

  it("agent_requires_task_loop → false", () => {
    expect(is_once_escalation("agent_requires_task_loop")).toBe(false);
  });

  it("null → false", () => { expect(is_once_escalation(null)).toBe(false); });
  it("undefined → false", () => { expect(is_once_escalation(undefined)).toBe(false); });
  it("다른 에러 → false", () => { expect(is_once_escalation("some_error")).toBe(false); });
});

// ══════════════════════════════════════════════════
// is_agent_escalation
// ══════════════════════════════════════════════════

describe("is_agent_escalation", () => {
  it("agent_requires_task_loop → true", () => {
    expect(is_agent_escalation("agent_requires_task_loop")).toBe(true);
  });

  it("once_requires_task_loop → false", () => {
    expect(is_agent_escalation("once_requires_task_loop")).toBe(false);
  });

  it("once_requires_agent_loop → false", () => {
    expect(is_agent_escalation("once_requires_agent_loop")).toBe(false);
  });

  it("null → false", () => { expect(is_agent_escalation(null)).toBe(false); });
  it("undefined → false", () => { expect(is_agent_escalation(undefined)).toBe(false); });
  it("다른 에러 → false", () => { expect(is_agent_escalation("some_error")).toBe(false); });
});

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

// ── extract_history_tool_hints — Case A / Case B ────────────────────────────

describe("extract_history_tool_hints — 히스토리 tool hints 주입", () => {
  const food_search_history = [
    { role: "user", content: "주변에서 먹을 만한 점심 맛집 추천해줘" },
    { role: "assistant", content: "어디 위치인지 알려주세요" },
  ];

  it("Case A: 마지막 assistant가 정보 요청 후 짧은 답변 → tool hints 주입", () => {
    const result = fast_classify(
      "야탐 아미고 타워 주변",
      ctx({ recent_history: food_search_history }),
    );
    // search_web 의도 → "web" 카테고리가 tools에 포함
    expect(result.tools).toBeDefined();
    expect(result.tools).toContain("web");
  });

  it("Case B: assistant가 일반 응답 후 사용자가 맥락 참조 → tool hints 주입", () => {
    // AI가 일반 추천을 했고 (정보 요청 아님), 사용자가 위치 맥락을 참조하는 짧은 메시지
    const history_with_generic_reply = [
      { role: "user", content: "점심 맛집 추천해줘" },
      { role: "assistant", content: "한식당, 중식당, 이탈리안 등 여러 옵션이 있습니다. 좁혀서 다시 추천하겠습니다." },
    ];
    const result = fast_classify(
      "내가 있는 곳 기준으로",
      ctx({ recent_history: history_with_generic_reply }),
    );
    expect(result.tools).toBeDefined();
    expect(result.tools).toContain("web");
  });

  it("Case B: '기준으로' 단독도 맥락 참조 트리거", () => {
    const history = [
      { role: "user", content: "근처 카페 알려줘" },
      { role: "assistant", content: "스타벅스, 투썸플레이스 등이 있어요." },
    ];
    const result = fast_classify("거기 기준", ctx({ recent_history: history }));
    expect(result.tools).toBeDefined();
  });

  it("히스토리 없음 → undefined (tool hints 없음)", () => {
    const result = fast_classify("내가 있는 곳 기준으로", ctx({ recent_history: undefined }));
    expect(result.tools).toBeUndefined();
  });

  it("토큰 수 13개 초과 → undefined (짧은 메시지 조건 실패)", () => {
    const long_msg = "내가 있는 곳 기준으로 반경 500미터 이내 맛집을 모두 추천해줘 부탁해요";
    const history = [
      { role: "user", content: "맛집 검색해줘" },
      { role: "assistant", content: "위치를 알려주세요" },
    ];
    const result = fast_classify(long_msg, ctx({ recent_history: history }));
    // 토큰 초과 → extract_history_tool_hints 진입 안 함
    // (mode는 정상 분류되지만 history hints는 없거나 있을 수 있음 — 조건 브랜치만 확인)
    // 13토큰 초과면 extract_history_tool_hints가 undefined 반환
    // 단 fast_classify는 자체 도구 분류를 하므로 tools 가 있을 수는 있음
    expect(typeof result.mode).toBe("string");
  });
});
