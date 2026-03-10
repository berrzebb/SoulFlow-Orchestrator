import { describe, it, expect } from "vitest";
import { MetricTool } from "@src/agent/tools/metric.js";

const tool = new MetricTool();

describe("MetricTool — parse_labels catch (L155) + metric_key labels (L159)", () => {
  it("parse_labels: 잘못된 JSON → catch 분기 → {} 반환 (L155)", async () => {
    const result = JSON.parse(
      await tool.execute({ action: "counter", name: "bad_labels_test", labels: "{invalid json}" }),
    );
    // 라벨 파싱 실패해도 메트릭은 동작함
    expect(result.type).toBe("counter");
    expect(result.labels).toEqual({});
  });

  it("metric_key: labels 있을 때 sorted key 생성 (L159)", async () => {
    const result = JSON.parse(
      await tool.execute({ action: "counter", name: "labeled_counter", labels: '{"env":"prod","region":"us"}' }),
    );
    expect(result.type).toBe("counter");
    expect(result.labels).toEqual({ env: "prod", region: "us" });
  });
});
