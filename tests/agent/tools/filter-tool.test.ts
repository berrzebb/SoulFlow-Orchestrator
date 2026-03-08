/**
 * FilterTool — where/find/reject/every/some/count 테스트.
 */
import { describe, it, expect } from "vitest";
import { FilterTool } from "../../../src/agent/tools/filter.js";

const tool = new FilterTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const USERS = JSON.stringify([
  { id: 1, name: "Alice", age: 30, role: "admin" },
  { id: 2, name: "Bob",   age: 25, role: "user" },
  { id: 3, name: "Carol", age: 35, role: "user" },
  { id: 4, name: "Dave",  age: 25, role: "admin" },
]);

describe("FilterTool — where", () => {
  it("eq 연산자: 숫자 일치 필터", async () => {
    const r = await exec({ action: "where", data: USERS, path: "age", operator: "eq", value: "25" }) as unknown[];
    expect(r).toHaveLength(2);
  });

  it("neq 연산자: 값 불일치 필터", async () => {
    const r = await exec({ action: "where", data: USERS, path: "role", operator: "neq", value: "admin" }) as unknown[];
    expect(r).toHaveLength(2);
  });

  it("gt 연산자: 초과 필터", async () => {
    const r = await exec({ action: "where", data: USERS, path: "age", operator: "gt", value: "25" }) as unknown[];
    expect(r).toHaveLength(2);
  });

  it("gte 연산자: 이상 필터", async () => {
    const r = await exec({ action: "where", data: USERS, path: "age", operator: "gte", value: "30" }) as unknown[];
    expect(r).toHaveLength(2);
  });

  it("lt / lte 연산자", async () => {
    const lt = await exec({ action: "where", data: USERS, path: "age", operator: "lt", value: "30" }) as unknown[];
    expect(lt).toHaveLength(2);
    const lte = await exec({ action: "where", data: USERS, path: "age", operator: "lte", value: "30" }) as unknown[];
    expect(lte).toHaveLength(3);
  });

  it("contains 연산자: 문자열 포함", async () => {
    const r = await exec({ action: "where", data: USERS, path: "name", operator: "contains", value: "o" }) as unknown[];
    expect(r).toHaveLength(2); // Bob, Carol
  });

  it("starts_with 연산자", async () => {
    const r = await exec({ action: "where", data: USERS, path: "name", operator: "starts_with", value: "A" }) as unknown[];
    expect(r).toHaveLength(1);
  });

  it("ends_with 연산자", async () => {
    const r = await exec({ action: "where", data: USERS, path: "name", operator: "ends_with", value: "e" }) as unknown[];
    expect(r).toHaveLength(2); // Alice, Dave
  });

  it("exists / not_exists 연산자", async () => {
    const data = JSON.stringify([{ a: 1 }, { b: 2 }, { a: null }]);
    const exists = await exec({ action: "where", data, path: "a", operator: "exists" }) as unknown[];
    expect(exists).toHaveLength(1);
    const not_exists = await exec({ action: "where", data, path: "a", operator: "not_exists" }) as unknown[];
    expect(not_exists).toHaveLength(2);
  });
});

describe("FilterTool — find", () => {
  it("첫 번째 일치 항목 반환", async () => {
    const r = await exec({ action: "find", data: USERS, path: "role", operator: "eq", value: "user" }) as Record<string, unknown>;
    expect(r.name).toBe("Bob");
  });

  it("일치 없으면 null 반환", async () => {
    const r = await exec({ action: "find", data: USERS, path: "age", operator: "gt", value: "100" });
    expect(r).toBeNull();
  });
});

describe("FilterTool — reject", () => {
  it("조건 불일치 항목만 반환", async () => {
    const r = await exec({ action: "reject", data: USERS, path: "role", operator: "eq", value: "admin" }) as unknown[];
    expect(r).toHaveLength(2);
  });
});

describe("FilterTool — every", () => {
  it("모두 일치 → true", async () => {
    const r = await exec({ action: "every", data: USERS, path: "age", operator: "gt", value: "0" }) as Record<string, unknown>;
    expect(r.result).toBe(true);
  });

  it("하나라도 불일치 → false", async () => {
    const r = await exec({ action: "every", data: USERS, path: "role", operator: "eq", value: "admin" }) as Record<string, unknown>;
    expect(r.result).toBe(false);
  });
});

describe("FilterTool — some", () => {
  it("하나라도 일치 → true", async () => {
    const r = await exec({ action: "some", data: USERS, path: "role", operator: "eq", value: "admin" }) as Record<string, unknown>;
    expect(r.result).toBe(true);
  });

  it("전부 불일치 → false", async () => {
    const r = await exec({ action: "some", data: USERS, path: "role", operator: "eq", value: "superuser" }) as Record<string, unknown>;
    expect(r.result).toBe(false);
  });
});

describe("FilterTool — count", () => {
  it("count + total 필드 반환", async () => {
    const r = await exec({ action: "count", data: USERS, path: "role", operator: "eq", value: "admin" }) as Record<string, unknown>;
    expect(r.count).toBe(2);
    expect(r.total).toBe(4);
  });
});

describe("FilterTool — 에러 케이스", () => {
  it("data가 JSON이 아닌 경우 → Error 문자열", async () => {
    const r = await exec({ action: "where", data: "not-json" });
    expect(String(r)).toContain("Error");
  });

  it("data가 배열이 아닌 경우 → Error", async () => {
    const r = await exec({ action: "where", data: '{"a":1}' });
    expect(String(r)).toContain("Error");
  });
});
