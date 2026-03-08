/** Phase 4.5+: hitl-pending-store 모듈 테스트
 *
 * 목표: workflow HITL 응답 대기 상태 저장소 테스트
 *       - set/get/delete CRUD 동작
 *       - try_resolve 응답 처리
 *       - entries 목록 조회
 */

import { describe, it, expect, vi } from "vitest";
import { HitlPendingStore } from "@src/orchestration/hitl-pending-store.js";

/* ── Tests ── */

describe("HitlPendingStore — HITL 응답 대기 저장소", () => {
  describe("CRUD 동작", () => {
    it("set: 항목 저장", () => {
      const store = new HitlPendingStore();
      const resolve = vi.fn();

      store.set("wf-1", { resolve, chat_id: "chat1" });

      expect(store.get("wf-1")).toBeDefined();
      expect(store.get("wf-1")?.chat_id).toBe("chat1");
    });

    it("get: 저장된 항목 조회", () => {
      const store = new HitlPendingStore();
      const resolve = vi.fn();
      const entry = { resolve, chat_id: "chat1" };

      store.set("wf-1", entry);
      const retrieved = store.get("wf-1");

      expect(retrieved).toEqual(entry);
    });

    it("get: 없는 항목 조회 → undefined", () => {
      const store = new HitlPendingStore();

      const result = store.get("wf-nonexistent");

      expect(result).toBeUndefined();
    });

    it("delete: 항목 삭제", () => {
      const store = new HitlPendingStore();
      const resolve = vi.fn();

      store.set("wf-1", { resolve, chat_id: "chat1" });
      store.delete("wf-1");

      expect(store.get("wf-1")).toBeUndefined();
    });

    it("delete: 없는 항목 삭제 (에러 없음)", () => {
      const store = new HitlPendingStore();

      expect(() => store.delete("wf-nonexistent")).not.toThrow();
    });
  });

  describe("응답 처리", () => {
    it("try_resolve: 존재하는 workflow에 응답 → true 반환", () => {
      const store = new HitlPendingStore();
      const resolve = vi.fn();

      store.set("wf-1", { resolve, chat_id: "chat1" });
      const result = store.try_resolve("chat1", "response content");

      expect(result).toBe(true);
      expect(resolve).toHaveBeenCalledWith("response content");
    });

    it("try_resolve: 응답 후 항목 자동 삭제", () => {
      const store = new HitlPendingStore();
      const resolve = vi.fn();

      store.set("wf-1", { resolve, chat_id: "chat1" });
      store.try_resolve("chat1", "response");

      expect(store.get("wf-1")).toBeUndefined();
    });

    it("try_resolve: 없는 chat_id → false 반환", () => {
      const store = new HitlPendingStore();
      const resolve = vi.fn();

      store.set("wf-1", { resolve, chat_id: "chat1" });
      const result = store.try_resolve("chat-nonexistent", "response");

      expect(result).toBe(false);
      expect(resolve).not.toHaveBeenCalled();
    });

    it("try_resolve: 저장소 비었을 때 → false 반환", () => {
      const store = new HitlPendingStore();

      const result = store.try_resolve("chat1", "response");

      expect(result).toBe(false);
    });

    it("try_resolve: 여러 항목 중 chat_id 매칭하는 첫 번째 반환", () => {
      const store = new HitlPendingStore();
      const resolve1 = vi.fn();
      const resolve2 = vi.fn();

      store.set("wf-1", { resolve: resolve1, chat_id: "chat1" });
      store.set("wf-2", { resolve: resolve2, chat_id: "chat2" });

      store.try_resolve("chat1", "response1");

      expect(resolve1).toHaveBeenCalledWith("response1");
      expect(resolve2).not.toHaveBeenCalled();
      expect(store.get("wf-1")).toBeUndefined();
      expect(store.get("wf-2")).toBeDefined();
    });
  });

  describe("목록 조회", () => {
    it("entries: 모든 항목 반복 가능", () => {
      const store = new HitlPendingStore();
      const resolve1 = vi.fn();
      const resolve2 = vi.fn();

      store.set("wf-1", { resolve: resolve1, chat_id: "chat1" });
      store.set("wf-2", { resolve: resolve2, chat_id: "chat2" });

      const entries = Array.from(store.entries());

      expect(entries).toHaveLength(2);
      expect(entries[0][0]).toBe("wf-1");
      expect(entries[1][0]).toBe("wf-2");
    });

    it("entries: 저장소 비었을 때 빈 배열", () => {
      const store = new HitlPendingStore();

      const entries = Array.from(store.entries());

      expect(entries).toHaveLength(0);
    });
  });

  describe("동시성 시나리오", () => {
    it("여러 workflow가 다른 chat_id로 pending 상태", () => {
      const store = new HitlPendingStore();
      const resolves = [vi.fn(), vi.fn(), vi.fn()];

      for (let i = 0; i < 3; i++) {
        store.set(`wf-${i}`, { resolve: resolves[i], chat_id: `chat${i}` });
      }

      expect(Array.from(store.entries())).toHaveLength(3);

      store.try_resolve("chat1", "response1");

      expect(resolves[1]).toHaveBeenCalledWith("response1");
      expect(Array.from(store.entries())).toHaveLength(2);
    });
  });
});
