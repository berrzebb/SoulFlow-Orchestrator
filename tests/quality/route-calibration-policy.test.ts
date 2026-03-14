import { describe, it, expect } from "vitest";
import {
  classify_misroute,
  evaluate_route,
  DEFAULT_ROUTE_CRITERIA,
  type RouteAcceptanceCriteria,
} from "@src/quality/route-calibration-policy.ts";

describe("classify_misroute — 동일 모드 → null", () => {
  it("once → once: misroute 없음", () => {
    expect(classify_misroute("once", "once")).toBeNull();
  });
  it("agent → agent: misroute 없음", () => {
    expect(classify_misroute("agent", "agent")).toBeNull();
  });
});

describe("classify_misroute — 주요 misroute 코드", () => {
  it("once 기대인데 agent 선택 → unnecessary_agent [major]", () => {
    const r = classify_misroute("agent", "once");
    expect(r).not.toBeNull();
    expect(r!.codes).toContain("unnecessary_agent");
    expect(r!.severity).toBe("major");
  });

  it("once 기대인데 task 선택 → unnecessary_task [major]", () => {
    const r = classify_misroute("task", "once");
    expect(r!.codes).toContain("unnecessary_task");
    expect(r!.severity).toBe("major");
  });

  it("once 기대인데 phase 선택 → phase_over_once [minor]", () => {
    const r = classify_misroute("phase", "once");
    expect(r!.codes).toContain("phase_over_once");
    expect(r!.severity).toBe("minor");
  });

  it("agent 기대인데 once 선택 → missed_agent [major]", () => {
    const r = classify_misroute("once", "agent");
    expect(r!.codes).toContain("missed_agent");
    expect(r!.severity).toBe("major");
  });

  it("매핑 없는 조합 → cost_tradeoff fallback", () => {
    const r = classify_misroute("task", "phase");
    expect(r!.codes).toContain("cost_tradeoff");
  });

  it("actual_mode, expected_mode 필드 정확히 반환", () => {
    const r = classify_misroute("agent", "once");
    expect(r!.actual_mode).toBe("agent");
    expect(r!.expected_mode).toBe("once");
  });
});

describe("evaluate_route — DEFAULT_ROUTE_CRITERIA (allowed: once|agent, preferred: once)", () => {
  it("once 선택 → passed: true, misroute 없음", () => {
    const r = evaluate_route("once", DEFAULT_ROUTE_CRITERIA);
    expect(r.passed).toBe(true);
    expect(r.misroute).toBeUndefined();
  });

  it("agent 선택 (허용 목록) → passed: true, cost_tradeoff minor 경고", () => {
    const r = evaluate_route("agent", DEFAULT_ROUTE_CRITERIA);
    expect(r.passed).toBe(true);
    expect(r.misroute?.codes).toContain("cost_tradeoff");
    expect(r.misroute?.severity).toBe("minor");
  });

  it("task 선택 (허용 외) → passed: false", () => {
    const r = evaluate_route("task", DEFAULT_ROUTE_CRITERIA);
    expect(r.passed).toBe(false);
    expect(r.misroute).not.toBeUndefined();
  });

  it("phase 선택 (허용 외) → passed: false", () => {
    const r = evaluate_route("phase", DEFAULT_ROUTE_CRITERIA);
    expect(r.passed).toBe(false);
  });
});

describe("evaluate_route — 커스텀 criteria", () => {
  const agent_only: RouteAcceptanceCriteria = {
    allowed_modes: ["agent", "task"],
    preferred_mode: "agent",
  };

  it("agent 선택 → passed: true, 경고 없음", () => {
    expect(evaluate_route("agent", agent_only).passed).toBe(true);
    expect(evaluate_route("agent", agent_only).misroute).toBeUndefined();
  });

  it("task 선택 (허용) → passed: true, cost_tradeoff minor", () => {
    const r = evaluate_route("task", agent_only);
    expect(r.passed).toBe(true);
    expect(r.misroute?.severity).toBe("minor");
  });

  it("once 선택 (허용 외) → passed: false", () => {
    expect(evaluate_route("once", agent_only).passed).toBe(false);
  });
});
