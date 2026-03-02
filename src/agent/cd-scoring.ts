/**
 * Clarification Debt (CD) 옵저버.
 * 세션 품질을 측정하는 경량 이벤트 감지기.
 *
 * - clarify (+10): 에이전트가 사용자에게 질문
 * - correct (+25): 동일 도구 3+ 연속 에러 후 방향 전환
 * - redo (+40): 이전 작업 롤백 후 재시도
 */

import type { AgentEvent } from "./agent.types.js";

export type CDIndicator = "clarify" | "correct" | "redo";

export type CDEvent = {
  indicator: CDIndicator;
  points: number;
  context: string;
  at: string;
};

const POINTS: Record<CDIndicator, number> = {
  clarify: 10,
  correct: 25,
  redo: 40,
};

export type CDObserver = {
  observe: (event: AgentEvent) => CDEvent | null;
  get_score: () => { total: number; events: CDEvent[] };
  reset: () => void;
};

export function create_cd_observer(): CDObserver {
  const events: CDEvent[] = [];
  /** 연속 에러 추적: tool_name → 연속 에러 수. */
  const consecutive_errors = new Map<string, number>();
  /** correct 감지 후 중복 방지. */
  const corrected_tools = new Set<string>();

  function push(indicator: CDIndicator, context: string, at: string): CDEvent {
    const cd: CDEvent = { indicator, points: POINTS[indicator], context, at };
    events.push(cd);
    return cd;
  }

  function observe(event: AgentEvent): CDEvent | null {
    // clarify: 사용자에게 질문하는 도구 호출
    if (event.type === "tool_use" && event.tool_name === "ask_user") {
      return push("clarify", `ask_user: ${String(event.params?.question || "").slice(0, 80)}`, event.at);
    }

    // correct: 동일 도구 3+ 연속 에러 후 다른 도구로 전환
    if (event.type === "tool_result") {
      const name = event.tool_name;
      if (event.is_error) {
        consecutive_errors.set(name, (consecutive_errors.get(name) || 0) + 1);
      } else {
        // 에러 아닌 결과 → 해당 도구 카운터 리셋
        const prev_count = consecutive_errors.get(name) || 0;
        consecutive_errors.set(name, 0);
        if (prev_count >= 3 && !corrected_tools.has(name)) {
          corrected_tools.add(name);
          return push("correct", `${name}: ${prev_count} errors then success`, event.at);
        }
      }
    }

    // correct 변형: 3+ 에러 후 다른 도구로 전환
    if (event.type === "tool_use") {
      for (const [prev_tool, count] of consecutive_errors) {
        if (count >= 3 && prev_tool !== event.tool_name && !corrected_tools.has(prev_tool)) {
          corrected_tools.add(prev_tool);
          return push("correct", `${prev_tool}: ${count} errors → switched to ${event.tool_name}`, event.at);
        }
      }
    }

    // redo: 에러 이벤트 (에이전트 레벨 실패 → 재시도 패턴)
    if (event.type === "error" && event.error.includes("rollback")) {
      return push("redo", event.error.slice(0, 80), event.at);
    }

    return null;
  }

  return {
    observe,
    get_score: () => ({
      total: events.reduce((sum, e) => sum + e.points, 0),
      events: [...events],
    }),
    reset: () => {
      events.length = 0;
      consecutive_errors.clear();
      corrected_tools.clear();
    },
  };
}
