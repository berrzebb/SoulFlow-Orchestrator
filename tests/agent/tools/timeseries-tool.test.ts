/**
 * TimeseriesTool — 시계열 분석 (이동평균/EMA/예측/이상감지/차분/누적합/정규화/자기상관) 테스트.
 */
import { describe, it, expect } from "vitest";
import { TimeseriesTool } from "../../../src/agent/tools/timeseries.js";

const tool = new TimeseriesTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const DATA = JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

describe("TimeseriesTool — moving_average", () => {
  it("3점 이동평균 (window=3)", async () => {
    const r = await exec({ action: "moving_average", data: DATA, window: 3 }) as Record<string, unknown>;
    const result = r.result as (number | null)[];
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toBe(2); // (1+2+3)/3 = 2
    expect(result[9]).toBe(9); // (8+9+10)/3 = 9
  });

  it("window 기본값 (3)", async () => {
    const r = await exec({ action: "moving_average", data: DATA }) as Record<string, unknown>;
    expect(r.window).toBe(3);
  });
});

describe("TimeseriesTool — ema", () => {
  it("EMA 계산 (alpha=0.5)", async () => {
    const r = await exec({ action: "ema", data: JSON.stringify([10, 20, 30]), alpha: 0.5 }) as Record<string, unknown>;
    const result = r.result as number[];
    expect(result[0]).toBe(10); // 첫 값은 그대로
    expect(result[1]).toBe(15); // 0.5*20 + 0.5*10 = 15
    expect(result[2]).toBe(22.5); // 0.5*30 + 0.5*15 = 22.5
  });

  it("alpha 기본값 (0.3)", async () => {
    const r = await exec({ action: "ema", data: DATA }) as Record<string, unknown>;
    expect(r.alpha).toBe(0.3);
  });
});

describe("TimeseriesTool — linear_forecast", () => {
  it("선형 데이터 예측 (y = x + 1)", async () => {
    const r = await exec({ action: "linear_forecast", data: DATA, periods: 3 }) as Record<string, unknown>;
    expect(r.slope).toBeCloseTo(1, 0); // 기울기 ≈ 1
    const forecast = r.forecast as number[];
    expect(forecast.length).toBe(3);
    expect(forecast[0]).toBeGreaterThan(10); // 10 이후 값
  });

  it("periods 기본값 (5)", async () => {
    const r = await exec({ action: "linear_forecast", data: DATA }) as Record<string, unknown>;
    expect((r.forecast as number[]).length).toBe(5);
  });
});

describe("TimeseriesTool — anomaly", () => {
  it("이상값 탐지", async () => {
    const data = JSON.stringify([1, 2, 1, 2, 1, 100, 2, 1]); // 100 이상
    const r = await exec({ action: "anomaly", data, threshold: 2 }) as Record<string, unknown>;
    expect(r.anomaly_count).toBeGreaterThan(0);
    const anomalies = r.anomalies as { index: number }[];
    expect(anomalies.some((a) => a.index === 5)).toBe(true);
  });

  it("이상값 없음", async () => {
    const r = await exec({ action: "anomaly", data: DATA, threshold: 3 }) as Record<string, unknown>;
    expect(r.anomaly_count).toBe(0);
  });

  it("threshold 기본값 (2)", async () => {
    const r = await exec({ action: "anomaly", data: DATA }) as Record<string, unknown>;
    expect(r.threshold).toBe(2);
  });
});

describe("TimeseriesTool — diff", () => {
  it("1계 차분 (각 값의 차이)", async () => {
    const r = await exec({ action: "diff", data: JSON.stringify([1, 3, 6, 10]) }) as Record<string, unknown>;
    expect(r.result).toEqual([2, 3, 4]); // 3-1, 6-3, 10-6
  });

  it("일정 간격 데이터 → 모두 같은 차이", async () => {
    const r = await exec({ action: "diff", data: DATA }) as Record<string, unknown>;
    const result = r.result as number[];
    expect(result.every((v) => v === 1)).toBe(true);
  });
});

describe("TimeseriesTool — cumsum", () => {
  it("누적합 계산", async () => {
    const r = await exec({ action: "cumsum", data: JSON.stringify([1, 2, 3, 4]) }) as Record<string, unknown>;
    expect(r.result).toEqual([1, 3, 6, 10]);
  });
});

describe("TimeseriesTool — normalize", () => {
  it("0~1 범위로 정규화", async () => {
    const r = await exec({ action: "normalize", data: DATA }) as Record<string, unknown>;
    const result = r.result as number[];
    expect(result[0]).toBe(0); // 최소값
    expect(result[result.length - 1]).toBe(1); // 최대값
  });

  it("모두 같은 값 → 모두 0", async () => {
    const r = await exec({ action: "normalize", data: JSON.stringify([5, 5, 5]) }) as Record<string, unknown>;
    const result = r.result as number[];
    expect(result.every((v) => v === 0)).toBe(true);
  });
});

describe("TimeseriesTool — autocorrelation", () => {
  it("lag=1 자기상관 계산", async () => {
    const r = await exec({ action: "autocorrelation", data: DATA, lag: 1 }) as Record<string, unknown>;
    expect(r.lag).toBe(1);
    // 선형 데이터는 양의 자기상관을 가짐
    expect(Number(r.autocorrelation)).toBeGreaterThan(0);
  });

  it("lag 기본값 (1)", async () => {
    const r = await exec({ action: "autocorrelation", data: DATA }) as Record<string, unknown>;
    expect(r.lag).toBe(1);
  });
});

describe("TimeseriesTool — 에러 처리", () => {
  it("빈 data → error", async () => {
    const r = await exec({ action: "moving_average", data: "[]" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("잘못된 JSON → error", async () => {
    const r = await exec({ action: "moving_average", data: "bad" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("미지원 action → error", async () => {
    const r = await exec({ action: "unknown", data: DATA }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});
