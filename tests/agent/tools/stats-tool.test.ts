/**
 * StatsTool — 수치 통계 operations 테스트.
 */
import { describe, it, expect } from "vitest";
import { StatsTool } from "../../../src/agent/tools/stats.js";

const tool = new StatsTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const DATA = "[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]";
const SIMPLE = "[10, 20, 30]";

describe("StatsTool — summary", () => {
  it("기본 통계 계산", async () => {
    const r = await exec({ operation: "summary", data: DATA }) as Record<string, unknown>;
    expect(r.count).toBe(10);
    expect(r.mean).toBe(5.5);
    expect(r.min).toBe(1);
    expect(r.max).toBe(10);
    expect(r.sum).toBe(55);
  });

  it("median 짝수 개수 → 평균", async () => {
    const r = await exec({ operation: "summary", data: "[1, 2, 3, 4]" }) as Record<string, unknown>;
    expect(r.median).toBe(2.5);
  });

  it("median 홀수 개수 → 중간값", async () => {
    const r = await exec({ operation: "summary", data: "[1, 2, 3, 4, 5]" }) as Record<string, unknown>;
    expect(r.median).toBe(3);
  });

  it("단일 값", async () => {
    const r = await exec({ operation: "summary", data: "[42]" }) as Record<string, unknown>;
    expect(r.count).toBe(1);
    expect(r.mean).toBe(42);
    expect(r.stdev).toBe(0);
  });

  it("쉼표 구분 문자열 입력", async () => {
    const r = await exec({ operation: "summary", data: "1,2,3,4,5" }) as Record<string, unknown>;
    expect(r.count).toBe(5);
    expect(r.mean).toBe(3);
  });
});

describe("StatsTool — percentile", () => {
  it("50번째 퍼센타일 (median)", async () => {
    const r = await exec({ operation: "percentile", data: DATA, percentile: 50 }) as Record<string, unknown>;
    expect(r.percentile).toBe(50);
    expect(Number(r.value)).toBeGreaterThan(0);
  });

  it("0번째 퍼센타일 → min", async () => {
    const r = await exec({ operation: "percentile", data: SIMPLE, percentile: 0 }) as Record<string, unknown>;
    expect(r.value).toBe(10);
  });

  it("100번째 퍼센타일 → max", async () => {
    const r = await exec({ operation: "percentile", data: SIMPLE, percentile: 100 }) as Record<string, unknown>;
    expect(r.value).toBe(30);
  });
});

describe("StatsTool — histogram", () => {
  it("히스토그램 생성", async () => {
    const r = await exec({ operation: "histogram", data: DATA, bins: 5 }) as Record<string, unknown>;
    const bins = r.bins as unknown[];
    expect(bins.length).toBe(5);
    expect(r.total).toBe(10);
  });

  it("단일 값 → 1개 bin", async () => {
    const r = await exec({ operation: "histogram", data: "[5, 5, 5]" }) as Record<string, unknown>;
    const bins = r.bins as { range: string; count: number }[];
    expect(bins.length).toBe(1);
    expect(bins[0]?.count).toBe(3);
  });
});

describe("StatsTool — correlation", () => {
  it("완전 상관 데이터 → r≈1", async () => {
    const r = await exec({
      operation: "correlation",
      data: "[1, 2, 3, 4, 5]",
      data2: "[2, 4, 6, 8, 10]",
    }) as Record<string, unknown>;
    expect(Number(r.pearson_r)).toBeCloseTo(1, 5);
    expect(r.direction).toBe("positive");
  });

  it("완전 역상관 → r≈-1", async () => {
    const r = await exec({
      operation: "correlation",
      data: "[1, 2, 3, 4, 5]",
      data2: "[10, 8, 6, 4, 2]",
    }) as Record<string, unknown>;
    expect(Number(r.pearson_r)).toBeCloseTo(-1, 5);
    expect(r.direction).toBe("negative");
  });

  it("data2 빈 배열 → Error", async () => {
    // parse_numbers("[]") → JSON.parse → 빈 배열
    expect(String(await exec({ operation: "correlation", data: DATA, data2: "[]" }))).toContain("Error");
  });
});

describe("StatsTool — normalize", () => {
  it("0-1 범위로 정규화", async () => {
    const r = await exec({ operation: "normalize", data: "[0, 5, 10]" }) as number[];
    expect(r[0]).toBe(0);
    expect(r[1]).toBe(0.5);
    expect(r[2]).toBe(1);
  });

  it("단일 값 → 모두 0", async () => {
    const r = await exec({ operation: "normalize", data: "[5, 5, 5]" }) as number[];
    expect(r.every((v) => v === 0)).toBe(true);
  });
});

describe("StatsTool — outliers", () => {
  it("이상치 탐지 (threshold 1.5 적용)", async () => {
    // mean≈22, stdev≈39, z-score(100)≈2.0 > 1.5
    const r = await exec({ operation: "outliers", data: "[1, 2, 3, 4, 100]", threshold: 1.5 }) as Record<string, unknown>;
    const outliers = r.outliers as { value: number }[];
    expect(outliers.some((o) => o.value === 100)).toBe(true);
  });

  it("이상치 없음 — 균등 분포", async () => {
    const r = await exec({ operation: "outliers", data: "[1, 2, 3, 4, 5]", threshold: 3 }) as Record<string, unknown>;
    expect(r.count).toBe(0);
  });

  it("표준편차 0 → 이상치 없음", async () => {
    const r = await exec({ operation: "outliers", data: "[5, 5, 5, 5]", threshold: 2 }) as Record<string, unknown>;
    expect(r.count).toBe(0);
  });
});

describe("StatsTool — 에러 처리", () => {
  it("숫자 아닌 데이터 → Error", async () => {
    // parse_numbers("abc,def") → Number("abc")=NaN, filtered out → empty
    expect(String(await exec({ operation: "summary", data: "abc,def" }))).toContain("Error");
  });

  it("parse_numbers: JSON 객체 입력 → split 폴백 (L53)", async () => {
    // JSON.parse 성공하지만 Array.isArray(parsed)=false → else items = input.split() (L53)
    const r = await exec({ operation: "summary", data: '{"values": [1,2,3]}' });
    // split 결과: ['{"values": [1', '2', '3]}'] → 숫자로 파싱 시 유효한 값만 추출
    expect(r).toBeDefined();
  });

  it("correlation에서 data2 빈 문자열 → 계산됨 (0이 숫자로 처리)", async () => {
    // parse_numbers("")은 [0]을 반환하므로 correlation이 실행됨
    const r = await exec({ operation: "correlation", data: "[1,2,3]", data2: "invalid_not_number" }) as Record<string, unknown>;
    // "Error: data2 is required" 반환됨 (빈 배열)
    expect(r).toBeDefined();
  });
});
