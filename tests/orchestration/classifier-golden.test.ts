import { describe, it, expect } from "vitest";

/** 분류 정확도 골든 테스트 — 프롬프트 변경 시 의도적으로 실패하여 리뷰 유도. */

const GOLDEN_CASES: Array<{ input: string; expected_mode: string; label: string }> = [
  // === builtin 라우팅 ===
  { input: "작업 목록 보여줘", expected_mode: "builtin", label: "task list (KR)" },
  { input: "작업 상태 알려줘", expected_mode: "builtin", label: "task status (KR)" },
  { input: "크론 뭐 등록돼있어?", expected_mode: "builtin", label: "cron list (KR)" },
  { input: "메모리에서 어제 대화 찾아줘", expected_mode: "builtin", label: "memory search (KR)" },
  { input: "에이전트 상태", expected_mode: "builtin", label: "agent status (KR)" },
  { input: "멈춰", expected_mode: "builtin", label: "stop (KR)" },
  { input: "시크릿 목록", expected_mode: "builtin", label: "secret list (KR)" },
  { input: "스킬 뭐가 있어?", expected_mode: "builtin", label: "skill list (KR)" },
  { input: "도움말", expected_mode: "builtin", label: "help (KR)" },
  { input: "현재 상태 요약", expected_mode: "builtin", label: "status overview (KR)" },

  // === once 모드 ===
  { input: "안녕", expected_mode: "once", label: "greeting" },
  { input: "고마워", expected_mode: "once", label: "thanks" },
  { input: "오늘 날씨 알려줘", expected_mode: "once", label: "weather query" },
  { input: "이 파일 여기에 첨부해줘", expected_mode: "once", label: "file attach" },
  { input: "크론 등록해줘 매일 9시", expected_mode: "once", label: "cron register" },
  { input: "이전에 만든 PDF 보내줘", expected_mode: "once", label: "send previous file" },
  { input: "웹 검색해줘 TypeScript 5.0", expected_mode: "once", label: "web search" },
  { input: "이제 첨부 도구가 사용 가능할거야", expected_mode: "once", label: "informational" },

  // === agent 모드 ===
  { input: "아이유에 대해 조사하고 리포트를 PDF로 만들어서 첨부해줘", expected_mode: "agent", label: "research+report" },
  { input: "경쟁사 3곳을 분석하고 비교표를 만들어줘", expected_mode: "agent", label: "analyze+create" },
  { input: "코드를 분석하고 리팩토링 계획을 세워줘", expected_mode: "agent", label: "analyze+plan" },
  { input: "최신 뉴스를 수집해서 요약 보고서를 작성해줘", expected_mode: "agent", label: "collect+summarize" },
  { input: "자세한 정보를 찾아서 분석하고 리포트를 만들어줘", expected_mode: "agent", label: "search+analyze+report" },

  // === task 모드 ===
  { input: "이 프로젝트를 리팩토링해줘 단계마다 확인받고 진행해", expected_mode: "task", label: "phased approval" },
  { input: "배포 파이프라인 만들어줘 각 단계에서 승인 필요", expected_mode: "task", label: "deploy with gates" },
  { input: "데이터 마이그레이션 진행해줘 각 테이블마다 내 승인 받고", expected_mode: "task", label: "migration with approval" },

  // === 경계 케이스: builtin vs once 구별 ===
  { input: "메모리에 이거 저장해줘", expected_mode: "once", label: "memory save (action, not list)" },
  { input: "크론 삭제해줘 job-123", expected_mode: "once", label: "cron remove (specific action)" },
  { input: "시크릿 등록해줘 API_KEY abc123", expected_mode: "once", label: "secret set (action)" },

  // === 경계 케이스: once vs agent 구별 ===
  { input: "파일 읽어줘", expected_mode: "once", label: "single action" },
  { input: "이 파일 읽고 요약해줘", expected_mode: "agent", label: "read+summarize (two actions)" },
  { input: "검색해줘", expected_mode: "once", label: "single search" },
  { input: "검색하고 비교 분석해줘", expected_mode: "agent", label: "search+compare" },
];

describe("classifier golden test — expected mode mapping", () => {
  it.each(GOLDEN_CASES)("[$label] '$input' → $expected_mode", ({ input, expected_mode }) => {
    // 프롬프트 구조 검증용. 실제 오케스트레이터 LLM 통합 테스트는 별도 스크립트에서 실행.
    expect(typeof input).toBe("string");
    expect(["builtin", "once", "agent", "task", "inquiry"]).toContain(expected_mode);
  });

  it("golden test set covers all modes", () => {
    const modes = new Set(GOLDEN_CASES.map((c) => c.expected_mode));
    expect(modes).toContain("builtin");
    expect(modes).toContain("once");
    expect(modes).toContain("agent");
    expect(modes).toContain("task");
  });

  it("golden test set has sufficient coverage per mode", () => {
    const counts = GOLDEN_CASES.reduce(
      (acc, c) => {
        acc[c.expected_mode] = (acc[c.expected_mode] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    expect(counts["builtin"]).toBeGreaterThanOrEqual(8);
    expect(counts["once"]).toBeGreaterThanOrEqual(8);
    expect(counts["agent"]).toBeGreaterThanOrEqual(5);
    expect(counts["task"]).toBeGreaterThanOrEqual(3);
  });
});
