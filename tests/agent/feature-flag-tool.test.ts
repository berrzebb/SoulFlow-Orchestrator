import { describe, it, expect } from "vitest";
import { FeatureFlagTool } from "../../src/agent/tools/feature-flag.js";

function make_tool() {
  return new FeatureFlagTool({ secret_vault: undefined as never });
}

describe("FeatureFlagTool", () => {
  const uid = () => `ff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  describe("define", () => {
    it("피처 플래그 정의", async () => {
      const name = uid();
      const r = JSON.parse(await make_tool().execute({
        action: "define", name, enabled: true, rollout_pct: 50,
        segments: JSON.stringify(["beta"]),
      }));
      expect(r.defined).toBe(name);
      expect(r.enabled).toBe(true);
      expect(r.rollout_pct).toBe(50);
      expect(r.segments).toEqual(["beta"]);
    });

    it("이름 없으면 에러", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "define" }));
      expect(r.error).toContain("name");
    });
  });

  describe("evaluate", () => {
    it("비활성 플래그 → false", async () => {
      const name = uid();
      const tool = make_tool();
      await tool.execute({ action: "define", name, enabled: false });
      const r = JSON.parse(await tool.execute({ action: "evaluate", name, user_id: "u1" }));
      expect(r.result).toBe(false);
      expect(r.reason).toBe("disabled");
    });

    it("100% 롤아웃 → true", async () => {
      const name = uid();
      const tool = make_tool();
      await tool.execute({ action: "define", name, enabled: true, rollout_pct: 100 });
      const r = JSON.parse(await tool.execute({ action: "evaluate", name, user_id: "u1" }));
      expect(r.result).toBe(true);
    });

    it("0% 롤아웃 → false", async () => {
      const name = uid();
      const tool = make_tool();
      await tool.execute({ action: "define", name, enabled: true, rollout_pct: 0 });
      const r = JSON.parse(await tool.execute({ action: "evaluate", name, user_id: "u1" }));
      expect(r.result).toBe(false);
    });

    it("세그먼트 불일치 → false", async () => {
      const name = uid();
      const tool = make_tool();
      await tool.execute({
        action: "define", name, enabled: true, rollout_pct: 100,
        segments: JSON.stringify(["premium"]),
      });
      const r = JSON.parse(await tool.execute({
        action: "evaluate", name, user_id: "u1",
        user_segments: JSON.stringify(["free"]),
      }));
      expect(r.result).toBe(false);
      expect(r.reason).toBe("segment_mismatch");
    });

    it("세그먼트 일치 + 100% → true", async () => {
      const name = uid();
      const tool = make_tool();
      await tool.execute({
        action: "define", name, enabled: true, rollout_pct: 100,
        segments: JSON.stringify(["premium"]),
      });
      const r = JSON.parse(await tool.execute({
        action: "evaluate", name, user_id: "u1",
        user_segments: JSON.stringify(["premium"]),
      }));
      expect(r.result).toBe(true);
    });
  });

  describe("override", () => {
    it("사용자 오버라이드 우선", async () => {
      const name = uid();
      const tool = make_tool();
      await tool.execute({ action: "define", name, enabled: false });
      await tool.execute({ action: "override", name, user_id: "vip", value: true });
      const r = JSON.parse(await tool.execute({ action: "evaluate", name, user_id: "vip" }));
      expect(r.result).toBe(true);
      expect(r.reason).toBe("override");
    });
  });

  describe("rollout", () => {
    it("롤아웃 비율 변경", async () => {
      const name = uid();
      const tool = make_tool();
      await tool.execute({ action: "define", name, rollout_pct: 10 });
      const r = JSON.parse(await tool.execute({ action: "rollout", name, rollout_pct: 80 }));
      expect(r.rollout_pct).toBe(80);
    });
  });

  describe("list", () => {
    it("플래그 목록 조회", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "list" }));
      expect(r.count).toBeGreaterThan(0);
      expect(Array.isArray(r.flags)).toBe(true);
    });
  });

  describe("stats", () => {
    it("평가 통계 조회", async () => {
      const name = uid();
      const tool = make_tool();
      await tool.execute({ action: "define", name, enabled: true, rollout_pct: 100 });
      await tool.execute({ action: "evaluate", name, user_id: "u1" });
      await tool.execute({ action: "evaluate", name, user_id: "u2" });
      const r = JSON.parse(await tool.execute({ action: "stats", name }));
      expect(r.eval_count).toBe(2);
      expect(r.true_count).toBe(2);
      expect(r.true_rate).toBe(100);
    });
  });
});
