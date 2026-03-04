import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AuthProfileTracker } from "@src/agent/pty/auth-profile-tracker.ts";

describe("AuthProfileTracker", () => {
  it("단일 프로파일이면 has_available()이 false", () => {
    const tracker = new AuthProfileTracker(1);
    expect(tracker.has_available()).toBe(false);
    expect(tracker.current).toBe(0);
  });

  it("라운드로빈으로 다음 프로파일로 전진한다", () => {
    const tracker = new AuthProfileTracker(3);
    expect(tracker.current).toBe(0);

    const next = tracker.mark_failure();
    expect(next).toBe(1);
    expect(tracker.current).toBe(1);

    const next2 = tracker.mark_failure();
    expect(next2).toBe(2);
    expect(tracker.current).toBe(2);
  });

  it("모든 프로파일 실패 시 null 반환", () => {
    const tracker = new AuthProfileTracker(2);
    tracker.mark_failure(); // 0→1
    const result = tracker.mark_failure(); // 1→null (0은 쿨다운)
    expect(result).toBeNull();
  });

  it("mark_good()이 프로파일을 active로 유지", () => {
    const tracker = new AuthProfileTracker(2);
    tracker.mark_good();
    expect(tracker.current).toBe(0);
    expect(tracker.has_available()).toBe(true);
  });

  describe("쿨다운 만료", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("쿨다운 만료 후 프로파일이 복구된다", () => {
      const tracker = new AuthProfileTracker(2, 1000);

      tracker.mark_failure(); // 0→쿨다운, current=1
      expect(tracker.current).toBe(1);

      // 1도 실패 → 0은 아직 쿨다운
      const result = tracker.mark_failure();
      expect(result).toBeNull();

      // 쿨다운 만료
      vi.advanceTimersByTime(1001);
      expect(tracker.has_available()).toBe(true);

      // 이제 mark_failure로 쿨다운 만료된 프로파일을 찾을 수 있어야 함
      // 새 tracker로 테스트
      const tracker2 = new AuthProfileTracker(2, 1000);
      tracker2.mark_failure(); // 0→쿨다운, current=1
      vi.advanceTimersByTime(1001);
      tracker2.mark_failure(); // 1→쿨다운, 0은 만료됨 → 복구
      expect(tracker2.current).toBe(0);
    });
  });

  it("resolve_env가 현재 프로파일의 환경변수를 반환한다", () => {
    const tracker = new AuthProfileTracker(3);
    const key_map = new Map<number, Record<string, string>>([
      [0, { API_KEY: "key-0" }],
      [1, { API_KEY: "key-1" }],
      [2, { API_KEY: "key-2" }],
    ]);

    expect(tracker.resolve_env(key_map)).toEqual({ API_KEY: "key-0" });

    tracker.mark_failure(); // → 1
    expect(tracker.resolve_env(key_map)).toEqual({ API_KEY: "key-1" });
  });

  it("없는 인덱스의 resolve_env는 빈 객체 반환", () => {
    const tracker = new AuthProfileTracker(2);
    const key_map = new Map<number, Record<string, string>>();
    expect(tracker.resolve_env(key_map)).toEqual({});
  });

  it("count가 프로파일 수를 반환한다", () => {
    expect(new AuthProfileTracker(5).count).toBe(5);
    expect(new AuthProfileTracker(0).count).toBe(1); // 최소 1
  });
});
