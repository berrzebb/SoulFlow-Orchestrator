import { describe, it, expect } from "vitest";
import { CircuitBreakerTool } from "../../src/agent/tools/circuit-breaker.js";

function make_tool() {
  return new CircuitBreakerTool({ secret_vault: undefined as never });
}

describe("CircuitBreakerTool", () => {
  // 모듈 스코프 상태를 공유하므로 유니크한 이름 사용
  const uid = () => `cb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  describe("create", () => {
    it("서킷 브레이커 생성", async () => {
      const name = uid();
      const r = JSON.parse(await make_tool().execute({
        action: "create", name, threshold: 3, reset_timeout_ms: 10000,
      }));
      expect(r.created).toBe(true);
      expect(r.state).toBe("closed");
      expect(r.threshold).toBe(3);
    });
  });

  describe("record_success / record_failure", () => {
    it("성공 기록", async () => {
      const name = uid();
      const tool = make_tool();
      await tool.execute({ action: "create", name, threshold: 3 });
      const r = JSON.parse(await tool.execute({ action: "record_success", name }));
      expect(r.state).toBe("closed");
      expect(r.success_count).toBe(1);
    });

    it("실패 threshold 도달 → open", async () => {
      const name = uid();
      const tool = make_tool();
      await tool.execute({ action: "create", name, threshold: 2 });
      await tool.execute({ action: "record_failure", name });
      const r = JSON.parse(await tool.execute({ action: "record_failure", name }));
      expect(r.state).toBe("open");
      expect(r.tripped).toBe(true);
    });
  });

  describe("get_state", () => {
    it("상태 조회", async () => {
      const name = uid();
      const tool = make_tool();
      await tool.execute({ action: "create", name });
      const r = JSON.parse(await tool.execute({ action: "get_state", name }));
      expect(r.state).toBe("closed");
      expect(r.can_request).toBe(true);
    });

    it("없는 브레이커 → not_found", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "get_state", name: "nonexistent_xxx" }));
      expect(r.state).toBe("not_found");
    });
  });

  describe("half_open 전이", () => {
    it("half_open에서 성공 → closed", async () => {
      const name = uid();
      const tool = make_tool();
      await tool.execute({ action: "create", name, threshold: 1, reset_timeout_ms: 1 });
      await tool.execute({ action: "record_failure", name });
      // 1ms 대기 후 get_state → half_open
      await new Promise((r) => setTimeout(r, 10));
      const state = JSON.parse(await tool.execute({ action: "get_state", name }));
      expect(state.state).toBe("half_open");
      // success → closed
      const r = JSON.parse(await tool.execute({ action: "record_success", name }));
      expect(r.state).toBe("closed");
    });
  });

  describe("reset", () => {
    it("리셋 → closed, 카운터 초기화", async () => {
      const name = uid();
      const tool = make_tool();
      await tool.execute({ action: "create", name, threshold: 1 });
      await tool.execute({ action: "record_failure", name });
      const r = JSON.parse(await tool.execute({ action: "reset", name }));
      expect(r.state).toBe("closed");
      expect(r.reset).toBe(true);
    });
  });

  describe("stats", () => {
    it("통계 조회", async () => {
      const name = uid();
      const tool = make_tool();
      await tool.execute({ action: "create", name });
      await tool.execute({ action: "record_success", name });
      await tool.execute({ action: "record_success", name });
      await tool.execute({ action: "record_failure", name });
      const r = JSON.parse(await tool.execute({ action: "stats", name }));
      expect(r.success_count).toBe(2);
      expect(r.failure_count).toBe(1);
      expect(r.uptime_percent).toBeGreaterThan(0);
    });
  });

  describe("config", () => {
    it("설정 변경", async () => {
      const name = uid();
      const tool = make_tool();
      await tool.execute({ action: "create", name, threshold: 5 });
      const r = JSON.parse(await tool.execute({ action: "config", name, threshold: 10 }));
      expect(r.threshold).toBe(10);
    });
  });

  describe("get_or_create 자동 생성 L126/127", () => {
    it("create 없이 record_success → 기본값으로 자동 생성", async () => {
      const name = uid();
      const tool = make_tool();
      // create 없이 바로 record_success → get_or_create L126/127 실행
      const r = JSON.parse(await tool.execute({ action: "record_success", name }));
      expect(r.name).toBe(name);
      expect(r.state).toBe("closed");
    });
  });
});
