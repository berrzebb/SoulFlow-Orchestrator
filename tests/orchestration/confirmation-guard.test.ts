import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConfirmationGuard, format_guard_prompt } from "@src/orchestration/confirmation-guard.js";

describe("ConfirmationGuard", () => {
  let guard: ConfirmationGuard;

  beforeEach(() => {
    guard = new ConfirmationGuard({ enabled: true, ttl_ms: 5000 });
  });

  describe("needs_confirmation", () => {
    it("비활성 시 항상 false", () => {
      guard.set_enabled(false);
      expect(guard.needs_confirmation("task", ["scheduling"])).toBe(false);
    });

    it("task 모드는 확인 필요", () => {
      expect(guard.needs_confirmation("task", [])).toBe(true);
    });

    it("scheduling 카테고리는 확인 필요", () => {
      expect(guard.needs_confirmation("once", ["scheduling"])).toBe(true);
    });

    it("once 모드 + 비대상 카테고리는 확인 불필요", () => {
      expect(guard.needs_confirmation("once", ["web"])).toBe(false);
    });

    it("skip_once가 설정되면 1회 스킵 후 소멸", () => {
      guard.store("slack", "ch1", "원본", "요약", "task", []);
      guard.try_resolve("slack", "ch1", "네");
      // skip_once 활성 → 1회 false
      expect(guard.needs_confirmation("task", [], "slack", "ch1")).toBe(false);
      // 소멸 후 다시 true
      expect(guard.needs_confirmation("task", [], "slack", "ch1")).toBe(true);
    });
  });

  describe("store / has_pending", () => {
    it("저장 후 has_pending=true", () => {
      guard.store("slack", "ch1", "원본", "요약", "task", []);
      expect(guard.has_pending("slack", "ch1")).toBe(true);
    });

    it("다른 chat_id에는 pending 없음", () => {
      guard.store("slack", "ch1", "원본", "요약", "task", []);
      expect(guard.has_pending("slack", "ch2")).toBe(false);
    });
  });

  describe("try_resolve", () => {
    beforeEach(() => {
      guard.store("slack", "ch1", "원본 텍스트", "요약", "task", []);
    });

    it("네 → confirmed + original_text 반환", () => {
      const r = guard.try_resolve("slack", "ch1", "네");
      expect(r).toEqual({ action: "confirmed", original_text: "원본 텍스트" });
      expect(guard.has_pending("slack", "ch1")).toBe(false);
    });

    it("yes → confirmed", () => {
      expect(guard.try_resolve("slack", "ch1", "yes")?.action).toBe("confirmed");
    });

    it("아니오 → cancelled", () => {
      const r = guard.try_resolve("slack", "ch1", "아니오");
      expect(r).toEqual({ action: "cancelled" });
    });

    it("관련 없는 메시지 → null, pending 폐기", () => {
      const r = guard.try_resolve("slack", "ch1", "다른 질문");
      expect(r).toBeNull();
      expect(guard.has_pending("slack", "ch1")).toBe(false);
    });

    it("pending 없는 채팅 → null", () => {
      expect(guard.try_resolve("slack", "ch2", "네")).toBeNull();
    });
  });

  describe("TTL 만료", () => {
    it("TTL 초과 시 has_pending=false", () => {
      vi.useFakeTimers();
      try {
        guard.store("slack", "ch1", "원본", "요약", "task", []);
        vi.advanceTimersByTime(6000);
        expect(guard.has_pending("slack", "ch1")).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("TTL 초과 시 try_resolve=null", () => {
      vi.useFakeTimers();
      try {
        guard.store("slack", "ch1", "원본", "요약", "task", []);
        vi.advanceTimersByTime(6000);
        expect(guard.try_resolve("slack", "ch1", "네")).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("set_enabled", () => {
    it("비활성화 시 pending/skip_once 초기화", () => {
      guard.store("slack", "ch1", "원본", "요약", "task", []);
      guard.set_enabled(false);
      expect(guard.has_pending("slack", "ch1")).toBe(false);
      expect(guard.enabled).toBe(false);
    });
  });

  describe("get_status", () => {
    it("상태 반환", () => {
      guard.store("slack", "ch1", "원본", "요약", "task", []);
      const s = guard.get_status();
      expect(s.enabled).toBe(true);
      expect(s.pending_count).toBe(1);
    });
  });
});

describe("format_guard_prompt", () => {
  it("요약과 모드 정보 포함", () => {
    const text = format_guard_prompt("뉴스 크론 등록", "task", ["scheduling"]);
    expect(text).toContain("뉴스 크론 등록");
    expect(text).toContain("task");
    expect(text).toContain("scheduling");
    expect(text).toContain("진행하시겠습니까?");
  });

  it("카테고리 없으면 기본 표시", () => {
    const text = format_guard_prompt("작업", "once", []);
    expect(text).toContain("기본");
  });
});
