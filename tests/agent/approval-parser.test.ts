/**
 * approval-parser.ts — parse_approval_response() 단위 테스트.
 * 한국어/영어/이모지 패턴, 신뢰도 계산, 엣지 케이스 검증.
 */
import { describe, it, expect } from "vitest";
import { parse_approval_response, type ApprovalDecision } from "@src/agent/tools/approval-parser.js";

function expect_decision(input: string, expected: ApprovalDecision) {
  const result = parse_approval_response(input);
  expect(result.decision).toBe(expected);
}

describe("parse_approval_response — approve 패턴", () => {
  it.each([
    "yes", "y", "ok", "okay", "approve", "approved", "allow", "go", "proceed",
  ])("영어 '%s' → approve", (input) => {
    expect_decision(input, "approve");
  });

  it.each([
    "승인", "허용", "진행", "좋아", "오케이", "가능",
  ])("한국어 '%s' → approve", (input) => {
    expect_decision(input, "approve");
  });

  it.each(["✅", "👍", "🟢", "🙆", "👌"])("이모지 '%s' → approve", (input) => {
    expect_decision(input, "approve");
  });

  it("대소문자 무시", () => {
    expect_decision("YES", "approve");
    expect_decision("Approve", "approve");
    expect_decision("OK", "approve");
  });

  it("문장 속 승인 키워드 감지", () => {
    expect_decision("네 승인합니다", "approve");
    expect_decision("yes, go ahead", "approve");
  });
});

describe("parse_approval_response — deny 패턴", () => {
  it.each([
    "no", "n", "deny", "denied", "reject", "stop", "block",
  ])("영어 '%s' → deny", (input) => {
    expect_decision(input, "deny");
  });

  it.each([
    "거절", "불가", "금지", "중단", "안돼", "안됨",
  ])("한국어 '%s' → deny", (input) => {
    expect_decision(input, "deny");
  });

  it.each(["❌", "👎", "🔴", "🙅", "⛔"])("이모지 '%s' → deny", (input) => {
    expect_decision(input, "deny");
  });
});

describe("parse_approval_response — defer 패턴", () => {
  it.each(["later", "hold", "wait", "defer", "postpone"])("영어 '%s' → defer", (input) => {
    expect_decision(input, "defer");
  });

  it.each(["보류", "대기", "나중에", "잠시"])("한국어 '%s' → defer", (input) => {
    expect_decision(input, "defer");
  });

  it.each(["⏳", "🤔"])("이모지 '%s' → defer", (input) => {
    expect_decision(input, "defer");
  });
});

describe("parse_approval_response — cancel 패턴", () => {
  it.each(["cancel", "abort", "drop"])("영어 '%s' → cancel", (input) => {
    expect_decision(input, "cancel");
  });

  it.each(["취소"])("한국어 '%s' → cancel", (input) => {
    expect_decision(input, "cancel");
  });
});

describe("parse_approval_response — clarify 패턴", () => {
  it.each(["why", "reason", "explain", "detail", "what"])("영어 '%s' → clarify", (input) => {
    expect_decision(input, "clarify");
  });

  it.each(["왜", "이유", "설명", "근거", "상세"])("한국어 '%s' → clarify", (input) => {
    expect_decision(input, "clarify");
  });
});

describe("parse_approval_response — unknown / 엣지 케이스", () => {
  it("빈 문자열 → unknown, confidence 0", () => {
    const result = parse_approval_response("");
    expect(result.decision).toBe("unknown");
    expect(result.confidence).toBe(0);
    expect(result.normalized).toBe("");
  });

  it("공백만 → unknown", () => {
    expect_decision("   ", "unknown");
  });

  it("관련 없는 텍스트 → unknown", () => {
    const result = parse_approval_response("오늘 날씨가 좋네요");
    expect(result.decision).toBe("unknown");
    expect(result.confidence).toBe(0.1);
  });

  it("normalized는 소문자로 반환", () => {
    const result = parse_approval_response("YES Please");
    expect(result.normalized).toBe(result.normalized.toLowerCase());
  });
});

describe("parse_approval_response — 신뢰도 (confidence)", () => {
  it("단일 매칭 → 기본 신뢰도 0.5+", () => {
    const result = parse_approval_response("yes");
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("다중 매칭 → 더 높은 신뢰도", () => {
    // "yes ok approved" → approve 패턴 3개 매칭
    const multi = parse_approval_response("yes ok approved");
    const single = parse_approval_response("yes");
    expect(multi.confidence).toBeGreaterThanOrEqual(single.confidence);
  });

  it("신뢰도는 1을 초과하지 않는다", () => {
    // 모든 approve 패턴을 포함하는 극단적 입력
    const result = parse_approval_response("yes ok okay approve approved allow go proceed ✅ 👍 🟢 승인 허용 진행");
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("경합 시 (approve + deny 동시) 낮은 margin → 낮은 신뢰도", () => {
    // "yes but no" → approve 1점, deny 1점 → margin 0 → 낮은 confidence
    const result = parse_approval_response("yes no");
    expect(result.confidence).toBe(0.5); // margin 0 → 0.5 + 0*0.2 = 0.5
  });

  it("명확한 단일 결정 → 높은 margin → 높은 신뢰도", () => {
    const result = parse_approval_response("approved allow proceed");
    expect(result.confidence).toBeGreaterThan(0.5);
  });
});

describe("parse_approval_response — 혼합 언어", () => {
  it("한국어 + 영어 혼합 승인", () => {
    const result = parse_approval_response("ok 진행해주세요");
    expect(result.decision).toBe("approve");
  });

  it("한국어 + 이모지 혼합 거절", () => {
    const result = parse_approval_response("안돼 ❌");
    expect(result.decision).toBe("deny");
  });

  it("clarify + deny 경합 시 동점이면 배열 순서 우선 (deny > clarify)", () => {
    // 패턴 그룹당 1점: clarify 1점(한글), deny 1점(한글) → 동점 → 배열 순서상 deny 우선
    const result = parse_approval_response("왜 거절? 이유 설명");
    expect(result.decision).toBe("deny");
  });
});
