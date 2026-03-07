import { describe, it, expect } from "vitest";
import { MetricTool } from "../../src/agent/tools/metric.js";

function make_tool() {
  return new MetricTool({ secret_vault: undefined as never });
}

describe("MetricTool", () => {
  // 모듈 스코프 전역 상태 주의 — 유니크 이름 사용
  const uid = () => `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  describe("counter", () => {
    it("카운터 증가", async () => {
      const name = uid();
      const tool = make_tool();
      await tool.execute({ action: "counter", name, value: 5 });
      const r = JSON.parse(await tool.execute({ action: "counter", name, value: 3 }));
      expect(r.type).toBe("counter");
      expect(r.value).toBe(8);
    });

    it("음수 값은 0으로 치환 (Math.max)", async () => {
      const name = uid();
      const tool = make_tool();
      await tool.execute({ action: "counter", name, value: 10 });
      const r = JSON.parse(await tool.execute({ action: "counter", name, value: -5 }));
      // Math.max(0, -5) = 0이므로 이전 값 유지
      expect(r.value).toBe(10);
    });
  });

  describe("gauge", () => {
    it("set 연산", async () => {
      const name = uid();
      const r = JSON.parse(await make_tool().execute({ action: "gauge", name, value: 42, op: "set" }));
      expect(r.value).toBe(42);
    });

    it("inc/dec 연산", async () => {
      const name = uid();
      const tool = make_tool();
      await tool.execute({ action: "gauge", name, value: 10, op: "set" });
      await tool.execute({ action: "gauge", name, value: 5, op: "inc" });
      const r = JSON.parse(await tool.execute({ action: "gauge", name, value: 3, op: "dec" }));
      expect(r.value).toBe(12); // 10 + 5 - 3
    });
  });

  describe("histogram", () => {
    it("히스토그램에 값 기록", async () => {
      const name = uid();
      const tool = make_tool();
      await tool.execute({ action: "histogram", name, value: 0.5 });
      await tool.execute({ action: "histogram", name, value: 1.5 });
      const r = JSON.parse(await tool.execute({ action: "histogram", name, value: 3.0 }));
      expect(r.count).toBe(3);
      expect(r.sum).toBeCloseTo(5.0);
      // buckets는 기본값 포함
      expect(r.buckets.length).toBeGreaterThan(0);
    });
  });

  describe("summary", () => {
    it("서머리 quantile 계산", async () => {
      const name = uid();
      const tool = make_tool();
      for (let i = 1; i <= 100; i++) {
        await tool.execute({ action: "summary", name, value: i });
      }
      const r = JSON.parse(await tool.execute({ action: "summary", name, value: 50 }));
      expect(r.count).toBe(101);
      expect(r.quantiles).toBeDefined();
      // 50th percentile는 50 부근
      const p50 = r.quantiles.find((q: { quantile: number }) => q.quantile === 0.5);
      expect(p50).toBeDefined();
    });
  });

  describe("collect", () => {
    it("등록된 메트릭 목록 조회", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "collect" }));
      expect(r.metric_count).toBeGreaterThan(0);
    });
  });

  describe("format_prometheus", () => {
    it("Prometheus 포맷 출력", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "format_prometheus" }));
      expect(r.format).toBe("prometheus");
      expect(r.text).toContain("# TYPE");
    });
  });

  describe("format_json", () => {
    it("JSON 포맷 출력", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "format_json" }));
      expect(r.metrics).toBeDefined();
      expect(Array.isArray(r.metrics)).toBe(true);
    });
  });
});
