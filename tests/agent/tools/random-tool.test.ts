/**
 * RandomTool — integer/float/choice/shuffle/sample/password/bytes/coin/dice 테스트.
 */
import { describe, it, expect } from "vitest";
import { RandomTool } from "../../../src/agent/tools/random.js";

const tool = new RandomTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("RandomTool — integer", () => {
  it("기본 범위(0~100) 내 정수 반환", async () => {
    const r = await exec({ action: "integer" }) as Record<string, unknown>;
    expect(typeof r.value).toBe("number");
    expect(Number(r.value)).toBeGreaterThanOrEqual(0);
    expect(Number(r.value)).toBeLessThanOrEqual(100);
  });

  it("지정 범위 내 정수 반환", async () => {
    const r = await exec({ action: "integer", min: 5, max: 10 }) as Record<string, unknown>;
    expect(Number(r.value)).toBeGreaterThanOrEqual(5);
    expect(Number(r.value)).toBeLessThanOrEqual(10);
  });
});

describe("RandomTool — float", () => {
  it("기본 범위(0~1) 내 부동소수 반환", async () => {
    const r = await exec({ action: "float" }) as Record<string, unknown>;
    expect(typeof r.value).toBe("number");
    expect(Number(r.value)).toBeGreaterThanOrEqual(0);
    expect(Number(r.value)).toBeLessThanOrEqual(1);
  });

  it("지정 범위 내 부동소수 반환", async () => {
    const r = await exec({ action: "float", min: 10, max: 20 }) as Record<string, unknown>;
    expect(Number(r.value)).toBeGreaterThanOrEqual(10);
    expect(Number(r.value)).toBeLessThanOrEqual(20);
  });
});

describe("RandomTool — choice", () => {
  it("배열에서 임의 항목 반환", async () => {
    const items = ["apple", "banana", "cherry"];
    const r = await exec({ action: "choice", items: JSON.stringify(items) }) as Record<string, unknown>;
    expect(items).toContain(r.value);
  });

  it("쉼표 구분 문자열도 파싱", async () => {
    const r = await exec({ action: "choice", items: "a,b,c" }) as Record<string, unknown>;
    expect(["a", "b", "c"]).toContain(r.value);
  });

  it("빈 배열 → Error", async () => {
    const r = await exec({ action: "choice", items: "[]" });
    expect(String(r)).toContain("Error");
  });
});

describe("RandomTool — shuffle", () => {
  it("배열 길이 동일하게 섞어 result 반환", async () => {
    const items = [1, 2, 3, 4, 5];
    const r = await exec({ action: "shuffle", items: JSON.stringify(items) }) as Record<string, unknown>;
    expect(Array.isArray(r.result)).toBe(true);
    expect((r.result as unknown[]).length).toBe(5);
    expect(r.result).toEqual(expect.arrayContaining(items));
  });
});

describe("RandomTool — sample", () => {
  it("N개 샘플 반환 (중복 없음)", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const r = await exec({ action: "sample", items: JSON.stringify(items), count: 3 }) as Record<string, unknown>;
    expect(Array.isArray(r.result)).toBe(true);
    expect((r.result as unknown[]).length).toBe(3);
    expect(r.count).toBe(3);
  });

  it("count > 배열 길이 → 배열 전체 반환", async () => {
    const r = await exec({ action: "sample", items: JSON.stringify([1, 2]), count: 10 }) as Record<string, unknown>;
    expect((r.result as unknown[]).length).toBe(2);
  });
});

describe("RandomTool — password", () => {
  it("기본 길이(16) + symbols 문자셋 비밀번호", async () => {
    const r = await exec({ action: "password" }) as Record<string, unknown>;
    expect(typeof r.password).toBe("string");
    expect(String(r.password).length).toBe(16);
    expect(r.length).toBe(16);
  });

  it("alphanumeric 문자셋", async () => {
    const r = await exec({ action: "password", length: 20, charset: "alphanumeric" }) as Record<string, unknown>;
    expect(String(r.password).length).toBe(20);
    expect(String(r.password)).toMatch(/^[A-Za-z0-9]+$/);
  });

  it("numeric 문자셋", async () => {
    const r = await exec({ action: "password", length: 8, charset: "numeric" }) as Record<string, unknown>;
    expect(String(r.password)).toMatch(/^\d+$/);
  });

  it("hex 문자셋", async () => {
    const r = await exec({ action: "password", length: 12, charset: "hex" }) as Record<string, unknown>;
    expect(String(r.password)).toMatch(/^[0-9a-f]+$/);
  });
});

describe("RandomTool — bytes", () => {
  it("hex 문자열 반환 (기본 16바이트 = 32 hex chars)", async () => {
    const r = await exec({ action: "bytes" }) as Record<string, unknown>;
    expect(typeof r.hex).toBe("string");
    expect(String(r.hex).length).toBe(32);
    expect(r.bytes).toBe(16);
  });

  it("count 지정 → 해당 바이트 수", async () => {
    const r = await exec({ action: "bytes", count: 4 }) as Record<string, unknown>;
    expect(String(r.hex).length).toBe(8);
    expect(r.bytes).toBe(4);
  });
});

describe("RandomTool — coin", () => {
  it("heads 또는 tails 반환", async () => {
    const r = await exec({ action: "coin" }) as Record<string, unknown>;
    expect(["heads", "tails"]).toContain(r.value);
  });
});

describe("RandomTool — dice", () => {
  it("기본 6면 주사위 1회 → rolls 배열 + sum", async () => {
    const r = await exec({ action: "dice" }) as Record<string, unknown>;
    expect(Array.isArray(r.rolls)).toBe(true);
    expect((r.rolls as number[]).length).toBe(1);
    expect(Number((r.rolls as number[])[0])).toBeGreaterThanOrEqual(1);
    expect(Number((r.rolls as number[])[0])).toBeLessThanOrEqual(6);
    expect(r.sum).toBe((r.rolls as number[])[0]);
  });

  it("sides + count 지정", async () => {
    const r = await exec({ action: "dice", sides: 20, count: 3 }) as Record<string, unknown>;
    expect((r.rolls as number[]).length).toBe(3);
    for (const roll of r.rolls as number[]) {
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(20);
    }
    const expected_sum = (r.rolls as number[]).reduce((a, b) => a + b, 0);
    expect(r.sum).toBe(expected_sum);
  });
});
