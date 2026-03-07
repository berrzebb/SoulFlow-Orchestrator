import { describe, it, expect } from "vitest";
import { RateLimitTool } from "../../src/agent/tools/rate-limit.js";

function make_tool() {
  return new RateLimitTool({ secret_vault: undefined as never });
}

describe("RateLimitTool", () => {
  const uid = () => `rl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  describe("check (token_bucket)", () => {
    it("새 버킷 → allowed=true", async () => {
      const key = uid();
      const r = JSON.parse(await make_tool().execute({
        action: "check", key, max_requests: 10, window_ms: 60000,
      }));
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(10);
    });
  });

  describe("consume (token_bucket)", () => {
    it("토큰 소비 → remaining 감소", async () => {
      const key = uid();
      const tool = make_tool();
      const r1 = JSON.parse(await tool.execute({
        action: "consume", key, max_requests: 5, window_ms: 60000,
      }));
      expect(r1.consumed).toBe(true);
      expect(r1.remaining).toBe(4);

      const r2 = JSON.parse(await tool.execute({
        action: "consume", key, max_requests: 5, window_ms: 60000,
      }));
      expect(r2.consumed).toBe(true);
      expect(r2.remaining).toBe(3);
    });

    it("토큰 소진 → consumed=false + retry_after_ms", async () => {
      const key = uid();
      const tool = make_tool();
      // 2개 제한
      await tool.execute({ action: "consume", key, max_requests: 2, window_ms: 60000 });
      await tool.execute({ action: "consume", key, max_requests: 2, window_ms: 60000 });
      const r = JSON.parse(await tool.execute({
        action: "consume", key, max_requests: 2, window_ms: 60000,
      }));
      expect(r.consumed).toBe(false);
      expect(r.retry_after_ms).toBeGreaterThan(0);
    });
  });

  describe("consume (sliding_window)", () => {
    it("슬라이딩 윈도우 소비", async () => {
      const key = uid();
      const tool = make_tool();
      const r = JSON.parse(await tool.execute({
        action: "consume", key, max_requests: 3, window_ms: 60000, algorithm: "sliding_window",
      }));
      expect(r.consumed).toBe(true);
      expect(r.remaining).toBe(2);
    });

    it("윈도우 초과 → consumed=false", async () => {
      const key = uid();
      const tool = make_tool();
      for (let i = 0; i < 2; i++) {
        await tool.execute({ action: "consume", key, max_requests: 2, window_ms: 60000, algorithm: "sliding_window" });
      }
      const r = JSON.parse(await tool.execute({
        action: "consume", key, max_requests: 2, window_ms: 60000, algorithm: "sliding_window",
      }));
      expect(r.consumed).toBe(false);
    });
  });

  describe("status", () => {
    it("존재하는 버킷 → exists=true", async () => {
      const key = uid();
      const tool = make_tool();
      await tool.execute({ action: "consume", key, max_requests: 10 });
      const r = JSON.parse(await tool.execute({ action: "status", key }));
      expect(r.exists).toBe(true);
      expect(r.key).toBe(key);
    });

    it("없는 버킷 → exists=false", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "status", key: "nonexistent_xxx" }));
      expect(r.exists).toBe(false);
    });
  });

  describe("reset", () => {
    it("버킷 삭제", async () => {
      const key = uid();
      const tool = make_tool();
      await tool.execute({ action: "consume", key, max_requests: 10 });
      const r = JSON.parse(await tool.execute({ action: "reset", key }));
      expect(r.reset).toBe(true);
    });
  });

  describe("list", () => {
    it("버킷 목록 조회", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "list" }));
      expect(r.buckets).toBeDefined();
      expect(r.count).toBeGreaterThanOrEqual(0);
    });
  });
});
