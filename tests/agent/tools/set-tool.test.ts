/**
 * SetTool — 집합 연산 (union/intersection/difference/subset/superset/equals/power_set/cartesian) 테스트.
 */
import { describe, it, expect } from "vitest";
import { SetTool } from "../../../src/agent/tools/set.js";

const tool = new SetTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const A = JSON.stringify([1, 2, 3, 4]);
const B = JSON.stringify([3, 4, 5, 6]);

describe("SetTool — union", () => {
  it("합집합", async () => {
    const r = await exec({ operation: "union", a: A, b: B }) as number[];
    expect(r).toContain(1);
    expect(r).toContain(3);
    expect(r).toContain(6);
    expect(new Set(r).size).toBe(r.length); // 중복 없음
  });
});

describe("SetTool — intersection", () => {
  it("교집합", async () => {
    const r = await exec({ operation: "intersection", a: A, b: B }) as number[];
    expect(r).toContain(3);
    expect(r).toContain(4);
    expect(r).not.toContain(1);
    expect(r).not.toContain(6);
  });

  it("공통 원소 없음 → 빈 배열", async () => {
    const r = await exec({ operation: "intersection", a: JSON.stringify([1, 2]), b: JSON.stringify([5, 6]) }) as unknown[];
    expect(r.length).toBe(0);
  });
});

describe("SetTool — difference", () => {
  it("차집합 (A - B)", async () => {
    const r = await exec({ operation: "difference", a: A, b: B }) as number[];
    expect(r).toContain(1);
    expect(r).toContain(2);
    expect(r).not.toContain(3);
    expect(r).not.toContain(5);
  });
});

describe("SetTool — symmetric_difference", () => {
  it("대칭 차집합", async () => {
    const r = await exec({ operation: "symmetric_difference", a: A, b: B }) as number[];
    expect(r).toContain(1);
    expect(r).toContain(2);
    expect(r).toContain(5);
    expect(r).toContain(6);
    expect(r).not.toContain(3);
    expect(r).not.toContain(4);
  });
});

describe("SetTool — is_subset", () => {
  it("부분집합 → true", async () => {
    const r = await exec({ operation: "is_subset", a: JSON.stringify([1, 2]), b: JSON.stringify([1, 2, 3]) });
    expect(String(r)).toBe("true");
  });

  it("부분집합 아님 → false", async () => {
    const r = await exec({ operation: "is_subset", a: JSON.stringify([1, 5]), b: JSON.stringify([1, 2, 3]) });
    expect(String(r)).toBe("false");
  });
});

describe("SetTool — is_superset", () => {
  it("상위집합 → true", async () => {
    const r = await exec({ operation: "is_superset", a: JSON.stringify([1, 2, 3]), b: JSON.stringify([1, 2]) });
    expect(String(r)).toBe("true");
  });
});

describe("SetTool — equals", () => {
  it("동일 집합 → true", async () => {
    const r = await exec({ operation: "equals", a: JSON.stringify([1, 2, 3]), b: JSON.stringify([3, 1, 2]) });
    expect(String(r)).toBe("true");
  });

  it("다른 집합 → false", async () => {
    const r = await exec({ operation: "equals", a: JSON.stringify([1, 2]), b: JSON.stringify([1, 3]) });
    expect(String(r)).toBe("false");
  });

  it("크기 다름 → false", async () => {
    const r = await exec({ operation: "equals", a: JSON.stringify([1, 2, 3]), b: JSON.stringify([1, 2]) });
    expect(String(r)).toBe("false");
  });
});

describe("SetTool — power_set", () => {
  it("부분집합 모음 생성", async () => {
    const r = await exec({ operation: "power_set", a: JSON.stringify([1, 2, 3]) }) as unknown[][];
    expect(r.length).toBe(8); // 2^3 = 8
    expect(r.some((s) => s.length === 0)).toBe(true); // 공집합 포함
    expect(r.some((s) => s.length === 3)).toBe(true); // 전체집합 포함
  });

  it("21개 이상 → Error", async () => {
    const large = JSON.stringify(Array.from({ length: 21 }, (_, i) => i));
    expect(String(await exec({ operation: "power_set", a: large }))).toContain("Error");
  });
});

describe("SetTool — cartesian_product", () => {
  it("데카르트 곱", async () => {
    const r = await exec({ operation: "cartesian_product", a: JSON.stringify([1, 2]), b: JSON.stringify(["a", "b"]) }) as unknown[][];
    expect(r.length).toBe(4); // 2 * 2 = 4
    expect(r.some((p) => p[0] === 1 && p[1] === "a")).toBe(true);
  });
});

describe("SetTool — 에러 처리", () => {
  it("지원하지 않는 operation → Error", async () => {
    expect(String(await exec({ operation: "invalid", a: JSON.stringify([1, 2]) }))).toContain("Error");
  });

  it("power_set 초과 원소 → Error", async () => {
    const large = JSON.stringify(Array.from({ length: 21 }, (_, i) => i + 1));
    expect(String(await exec({ operation: "power_set", a: large }))).toContain("Error");
  });
});
