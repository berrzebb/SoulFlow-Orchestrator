/**
 * F3: Route Calibration Policy — 실행 모드 선택의 적합성 판정.
 *
 * 분류기(classifier)가 선택한 모드가 요청 특성에 적합한지 판정하는 정책 레이어.
 * 실행 성공 여부와 무관하게 "더 나은 모드가 있었는가"를 추적한다.
 */

import type { ExecutionMode } from "../orchestration/types.js";

export type { ExecutionMode };

/**
 * 잘못된 라우팅의 원인 코드.
 * 분류기 오류가 아니라 "수용 기준 위반"을 설명한다.
 */
export type MisrouteCode =
  | "unnecessary_agent"   // agent 불필요 — once/direct 충분한 단순 요청
  | "unnecessary_task"    // task 불필요 — 동기 처리 가능한 작업
  | "missed_agent"        // once 선택 — 다단계 처리가 필요했음
  | "phase_over_once"     // phase 선택 — 단일 LLM 호출로 충분
  | "cost_tradeoff"       // 올바른 모드지만 더 저렴한 대안 존재
  | "latency_tradeoff";   // 올바른 모드지만 더 빠른 대안 존재

export interface MisrouteResult {
  actual_mode: ExecutionMode;
  expected_mode: ExecutionMode;
  codes: MisrouteCode[];
  /** major: 핵심 경로 잘못됨 / minor: 비용·레이턴시 차선 */
  severity: "major" | "minor";
}

/**
 * 특정 요청 유형에 허용되는 실행 모드 기준.
 * preferred_mode가 허용 목록에 포함되어야 한다.
 */
export interface RouteAcceptanceCriteria {
  allowed_modes: ExecutionMode[];
  preferred_mode: ExecutionMode;
}

/** 기본 기준: once를 선호, once/agent 모두 허용. */
export const DEFAULT_ROUTE_CRITERIA: RouteAcceptanceCriteria = {
  allowed_modes: ["once", "agent"],
  preferred_mode: "once",
};

/**
 * 두 모드 간 미스루트 코드를 결정.
 * actual === expected이면 null 반환 (정상).
 */
export function classify_misroute(
  actual: ExecutionMode,
  expected: ExecutionMode,
): MisrouteResult | null {
  if (actual === expected) return null;

  const codes: MisrouteCode[] = [];

  if (expected === "once" && actual === "agent") codes.push("unnecessary_agent");
  if (expected === "once" && actual === "task") codes.push("unnecessary_task");
  if (expected === "once" && actual === "phase") codes.push("phase_over_once");
  if (expected === "agent" && actual === "once") codes.push("missed_agent");
  if (expected === "task" && actual === "agent") codes.push("unnecessary_agent");
  if (expected === "agent" && actual === "phase") codes.push("phase_over_once");

  if (codes.length === 0) codes.push("cost_tradeoff");

  const MAJOR_CODES: MisrouteCode[] = ["missed_agent", "unnecessary_agent", "unnecessary_task"];
  const severity: "major" | "minor" =
    codes.some((c) => MAJOR_CODES.includes(c)) ? "major" : "minor";

  return { actual_mode: actual, expected_mode: expected, codes, severity };
}

/**
 * 실제 모드가 수용 기준을 통과하는지 평가.
 * 허용 목록에 없으면 misroute, preferred_mode와 다르면 cost/latency tradeoff.
 */
export function evaluate_route(
  actual: ExecutionMode,
  criteria: RouteAcceptanceCriteria,
): { passed: boolean; misroute?: MisrouteResult } {
  if (!criteria.allowed_modes.includes(actual)) {
    const misroute = classify_misroute(actual, criteria.preferred_mode) ?? {
      actual_mode: actual,
      expected_mode: criteria.preferred_mode,
      codes: ["cost_tradeoff" as MisrouteCode],
      severity: "major" as const,
    };
    return { passed: false, misroute };
  }

  if (actual !== criteria.preferred_mode) {
    const codes: MisrouteCode[] = ["cost_tradeoff"];
    return {
      passed: true,
      misroute: { actual_mode: actual, expected_mode: criteria.preferred_mode, codes, severity: "minor" },
    };
  }

  return { passed: true };
}
