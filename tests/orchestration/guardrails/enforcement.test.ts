import { describe, it, expect } from "vitest";
import {
  build_session_evidence,
  format_reuse_reply,
  create_budget_tracker,
  is_over_budget,
  remaining_budget,
  STOP_REASON_BUDGET_EXCEEDED,
} from "../../../src/orchestration/guardrails/enforcement.js";

// ── build_session_evidence ──

describe("build_session_evidence", () => {
  it("빈 히스토리 → 빈 recent_queries", () => {
    const snap = build_session_evidence([], 1000, 300_000);
    expect(snap.recent_queries).toEqual([]);
  });

  it("user 메시지 1개 → 현재 질의 제외 → 빈 결과", () => {
    const snap = build_session_evidence(
      [{ role: "user", content: "hello" }],
      1000, 300_000,
    );
    expect(snap.recent_queries).toHaveLength(0);
  });

  it("user 2개 → 마지막 제외 → 1개 반환", () => {
    const snap = build_session_evidence(
      [
        { role: "user", content: "first" },
        { role: "assistant", content: "reply" },
        { role: "user", content: "second" },
      ],
      10_000, 5_000,
    );
    expect(snap.recent_queries).toHaveLength(1);
    expect(snap.recent_queries[0].original).toBe("first");
  });

  it("assistant 메시지는 무시", () => {
    const snap = build_session_evidence(
      [
        { role: "user", content: "q1" },
        { role: "assistant", content: "a1" },
        { role: "assistant", content: "a2" },
        { role: "user", content: "q2" },
      ],
      10_000, 5_000,
    );
    expect(snap.recent_queries).toHaveLength(1);
    expect(snap.recent_queries[0].original).toBe("q1");
  });

  it("normalized 필드가 정규화된 텍스트", () => {
    const snap = build_session_evidence(
      [
        { role: "user", content: "Hello, World!" },
        { role: "assistant", content: "reply" },
        { role: "user", content: "current" },
      ],
      10_000, 5_000,
    );
    expect(snap.recent_queries[0].normalized).toBe("hello world");
  });

  it("timestamp_ms가 freshness window 내에 분포", () => {
    const now = 100_000;
    const window = 50_000;
    const snap = build_session_evidence(
      [
        { role: "user", content: "a" },
        { role: "assistant", content: "a-reply" },
        { role: "user", content: "b" },
        { role: "assistant", content: "b-reply" },
        { role: "user", content: "c" },
        { role: "assistant", content: "c-reply" },
        { role: "user", content: "current" },
      ],
      now, window,
    );
    expect(snap.recent_queries).toHaveLength(3);
    for (const q of snap.recent_queries) {
      expect(q.timestamp_ms).toBeGreaterThanOrEqual(now - window);
      expect(q.timestamp_ms).toBeLessThanOrEqual(now);
    }
  });
});

// ── format_reuse_reply ──

describe("format_reuse_reply", () => {
  it("reuse_summary → 재사용 안내 텍스트", () => {
    const text = format_reuse_reply({ kind: "reuse_summary", matched_query: "hello", age_ms: 1000 });
    expect(text).toContain("동일");
    expect(text).toContain("hello");
  });

  it("same_topic → 유사 질의 안내 텍스트", () => {
    const text = format_reuse_reply({ kind: "same_topic", matched_query: "world", age_ms: 2000 });
    expect(text).toContain("유사");
    expect(text).toContain("world");
  });

  it("new_search → 빈 문자열", () => {
    expect(format_reuse_reply({ kind: "new_search" })).toBe("");
  });
});

// ── BudgetTracker ──

describe("BudgetTracker", () => {
  it("create: max 반영, used = 0", () => {
    const t = create_budget_tracker(10);
    expect(t.max).toBe(10);
    expect(t.used).toBe(0);
  });

  it("is_over_budget: 미달 → false", () => {
    const t = create_budget_tracker(5);
    t.used = 3;
    expect(is_over_budget(t)).toBe(false);
  });

  it("is_over_budget: 정확히 한도 → true", () => {
    const t = create_budget_tracker(5);
    t.used = 5;
    expect(is_over_budget(t)).toBe(true);
  });

  it("is_over_budget: 한도 초과 → true", () => {
    const t = create_budget_tracker(5);
    t.used = 7;
    expect(is_over_budget(t)).toBe(true);
  });

  it("is_over_budget: max = 0 (비활성) → 항상 false", () => {
    const t = create_budget_tracker(0);
    t.used = 9999;
    expect(is_over_budget(t)).toBe(false);
  });

  it("remaining_budget: 정확한 잔여 계산", () => {
    const t = create_budget_tracker(10);
    t.used = 3;
    expect(remaining_budget(t)).toBe(7);
  });

  it("remaining_budget: 초과해도 음수 아님", () => {
    const t = create_budget_tracker(5);
    t.used = 10;
    expect(remaining_budget(t)).toBe(0);
  });

  it("remaining_budget: max = 0 → Infinity", () => {
    const t = create_budget_tracker(0);
    expect(remaining_budget(t)).toBe(Infinity);
  });

  it("mutable: used를 직접 증가 가능 (handler 공유)", () => {
    const t = create_budget_tracker(100);
    t.used += 1;
    t.used += 1;
    expect(t.used).toBe(2);
  });
});

describe("STOP_REASON_BUDGET_EXCEEDED", () => {
  it("상수값 고정", () => {
    expect(STOP_REASON_BUDGET_EXCEEDED).toBe("max_tool_calls_exceeded");
  });
});
