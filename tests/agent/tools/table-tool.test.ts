/**
 * TableTool — 배열-of-객체 정렬, 필터, group_by, join, pivot, aggregate 테스트.
 */
import { describe, it, expect } from "vitest";
import { TableTool } from "../../../src/agent/tools/table.js";

const tool = new TableTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const PEOPLE = JSON.stringify([
  { name: "Alice", age: 30, dept: "eng" },
  { name: "Bob", age: 25, dept: "hr" },
  { name: "Carol", age: 35, dept: "eng" },
  { name: "Dave", age: 25, dept: "hr" },
]);

const ORDERS = JSON.stringify([
  { id: 1, amount: 100 },
  { id: 2, amount: 200 },
  { id: 3, amount: 150 },
]);

describe("TableTool — sort", () => {
  it("숫자 필드 오름차순 정렬", async () => {
    const r = await exec({ operation: "sort", data: PEOPLE, field: "age" }) as Record<string, unknown>[];
    expect(r[0].age).toBe(25);
    expect(r[r.length - 1].age).toBe(35);
  });

  it("숫자 필드 내림차순 정렬", async () => {
    const r = await exec({ operation: "sort", data: PEOPLE, field: "age", order: "desc" }) as Record<string, unknown>[];
    expect(r[0].age).toBe(35);
    expect(r[r.length - 1].age).toBe(25);
  });

  it("문자열 필드 정렬", async () => {
    const r = await exec({ operation: "sort", data: PEOPLE, field: "name" }) as Record<string, unknown>[];
    expect(r[0].name).toBe("Alice");
    expect(r[r.length - 1].name).toBe("Dave");
  });

  it("null 값은 마지막으로", async () => {
    const data = JSON.stringify([{ v: 1 }, { v: null }, { v: 2 }]);
    const r = await exec({ operation: "sort", data, field: "v" }) as Record<string, unknown>[];
    expect(r[r.length - 1].v).toBeNull();
  });

  it("field 없음 → Error", async () => {
    expect(String(await exec({ operation: "sort", data: PEOPLE, field: "" }))).toContain("Error");
  });
});

describe("TableTool — filter", () => {
  it("조건 필터 (나이 30 이상)", async () => {
    const r = await exec({ operation: "filter", data: PEOPLE, condition: "row.age >= 30" }) as Record<string, unknown>[];
    expect(r.length).toBe(2);
    expect(r.every((p) => (p.age as number) >= 30)).toBe(true);
  });

  it("문자열 조건 필터", async () => {
    const r = await exec({ operation: "filter", data: PEOPLE, condition: 'row.dept === "eng"' }) as Record<string, unknown>[];
    expect(r.length).toBe(2);
  });

  it("잘못된 조건 → Error", async () => {
    expect(String(await exec({ operation: "filter", data: PEOPLE, condition: "invalid >>>" }))).toContain("Error");
  });
});

describe("TableTool — group_by", () => {
  it("dept 기준 그룹화", async () => {
    const r = await exec({ operation: "group_by", data: PEOPLE, field: "dept" }) as Record<string, unknown[]>;
    expect(Object.keys(r)).toContain("eng");
    expect(Object.keys(r)).toContain("hr");
    expect(r.eng.length).toBe(2);
    expect(r.hr.length).toBe(2);
  });

  it("field 없음 → Error", async () => {
    expect(String(await exec({ operation: "group_by", data: PEOPLE, field: "" }))).toContain("Error");
  });
});

describe("TableTool — join", () => {
  const USERS = JSON.stringify([
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
    { id: 3, name: "Carol" },
  ]);
  const SCORES = JSON.stringify([
    { id: 1, score: 90 },
    { id: 2, score: 80 },
    { id: 4, score: 70 },
  ]);

  it("inner join", async () => {
    const r = await exec({ operation: "join", data: USERS, data2: SCORES, join_field: "id", join_type: "inner" }) as Record<string, unknown>[];
    expect(r.length).toBe(2); // id 1, 2만 매칭
    expect(r.some((x) => x.score === 90)).toBe(true);
  });

  it("left join", async () => {
    const r = await exec({ operation: "join", data: USERS, data2: SCORES, join_field: "id", join_type: "left" }) as Record<string, unknown>[];
    expect(r.length).toBe(3); // USERS 전체
    const carol = r.find((x) => x.name === "Carol");
    expect(carol?.score).toBeUndefined();
  });

  it("right join", async () => {
    const r = await exec({ operation: "join", data: USERS, data2: SCORES, join_field: "id", join_type: "right" }) as Record<string, unknown>[];
    // id=4는 USERS에 없으므로 SCORES에서만 추가
    expect(r.some((x) => x.score === 70)).toBe(true);
  });

  it("full join", async () => {
    const r = await exec({ operation: "join", data: USERS, data2: SCORES, join_field: "id", join_type: "full" }) as Record<string, unknown>[];
    expect(r.length).toBeGreaterThanOrEqual(4);
  });
});

describe("TableTool — pivot", () => {
  const SALES = JSON.stringify([
    { region: "North", amount: 100 },
    { region: "North", amount: 200 },
    { region: "South", amount: 150 },
  ]);

  it("pivot — sum (기본)", async () => {
    const r = await exec({ operation: "pivot", data: SALES, field: "region", value_field: "amount", agg: "sum" }) as Record<string, number>;
    expect(r.North).toBe(300);
    expect(r.South).toBe(150);
  });

  it("pivot — avg", async () => {
    const r = await exec({ operation: "pivot", data: SALES, field: "region", value_field: "amount", agg: "avg" }) as Record<string, number>;
    expect(r.North).toBe(150);
  });

  it("pivot — count", async () => {
    const r = await exec({ operation: "pivot", data: SALES, field: "region", value_field: "amount", agg: "count" }) as Record<string, number>;
    expect(r.North).toBe(2);
    expect(r.South).toBe(1);
  });

  it("field 없음 → Error", async () => {
    expect(String(await exec({ operation: "pivot", data: SALES, field: "" }))).toContain("Error");
  });
});

describe("TableTool — aggregate", () => {
  it("sum", async () => {
    const r = await exec({ operation: "aggregate", data: ORDERS, field: "amount", agg: "sum" }) as Record<string, unknown>;
    expect(r.value).toBe(450);
  });

  it("avg", async () => {
    const r = await exec({ operation: "aggregate", data: ORDERS, field: "amount", agg: "avg" }) as Record<string, unknown>;
    expect(r.value).toBe(150);
  });

  it("min / max", async () => {
    const min = await exec({ operation: "aggregate", data: ORDERS, field: "amount", agg: "min" }) as Record<string, unknown>;
    const max = await exec({ operation: "aggregate", data: ORDERS, field: "amount", agg: "max" }) as Record<string, unknown>;
    expect(min.value).toBe(100);
    expect(max.value).toBe(200);
  });

  it("count", async () => {
    const r = await exec({ operation: "aggregate", data: ORDERS, field: "amount", agg: "count" }) as Record<string, unknown>;
    expect(r.value).toBe(3);
  });

  it("빈 배열 → value 0", async () => {
    const r = await exec({ operation: "aggregate", data: "[]", field: "amount", agg: "sum" }) as Record<string, unknown>;
    expect(r.value).toBe(0);
  });
});

describe("TableTool — distinct", () => {
  it("특정 필드 중복 제거", async () => {
    const r = await exec({ operation: "distinct", data: PEOPLE, field: "dept" }) as unknown[];
    expect(r.length).toBe(2);
    expect(r).toContain("eng");
    expect(r).toContain("hr");
  });

  it("field 없음 → 전체 행 중복 제거", async () => {
    const data = JSON.stringify([{ a: 1 }, { a: 2 }, { a: 1 }]);
    const r = await exec({ operation: "distinct", data, field: "" }) as unknown[];
    expect(r.length).toBe(2);
  });
});

describe("TableTool — slice", () => {
  it("start=1, end=3", async () => {
    const r = await exec({ operation: "slice", data: PEOPLE, start: 1, end: 3 }) as Record<string, unknown>[];
    expect(r.length).toBe(2);
    expect(r[0].name).toBe("Bob");
  });

  it("인덱스 없음 → 전체 반환", async () => {
    const r = await exec({ operation: "slice", data: PEOPLE }) as Record<string, unknown>[];
    expect(r.length).toBe(4);
  });
});

describe("TableTool — pluck", () => {
  it("단일 필드 pluck", async () => {
    const r = await exec({ operation: "pluck", data: PEOPLE, fields: "name" }) as unknown[];
    expect(r).toEqual(["Alice", "Bob", "Carol", "Dave"]);
  });

  it("복수 필드 pluck", async () => {
    const r = await exec({ operation: "pluck", data: PEOPLE, fields: "name,age" }) as Record<string, unknown>[];
    expect(r[0]).toEqual({ name: "Alice", age: 30 });
    expect(Object.keys(r[0])).not.toContain("dept");
  });

  it("fields 없음 → 전체 반환", async () => {
    const r = await exec({ operation: "pluck", data: PEOPLE, fields: "" }) as Record<string, unknown>[];
    expect(Object.keys(r[0])).toContain("dept");
  });
});

describe("TableTool — count_by", () => {
  it("dept 기준 카운트", async () => {
    const r = await exec({ operation: "count_by", data: PEOPLE, field: "dept" }) as Record<string, number>;
    expect(r.eng).toBe(2);
    expect(r.hr).toBe(2);
  });

  it("field 없음 → total 반환", async () => {
    const r = await exec({ operation: "count_by", data: PEOPLE, field: "" }) as Record<string, number>;
    expect(r.total).toBe(4);
  });
});

describe("TableTool — 에러 처리", () => {
  it("지원하지 않는 operation → Error", async () => {
    expect(String(await exec({ operation: "invalid", data: PEOPLE }))).toContain("Error");
  });

  it("잘못된 JSON data → Error", async () => {
    expect(String(await exec({ operation: "sort", data: "not-json", field: "name" }))).toContain("Error");
  });

  it("MAX_ROWS 초과 → Error", async () => {
    // 50,001개 행 (직접 생성은 무거우므로 문자열로 조작)
    const large = "[" + Array.from({ length: 50001 }, (_, i) => `{"i":${i}}`).join(",") + "]";
    expect(String(await exec({ operation: "sort", data: large, field: "i" }))).toContain("Error");
  });
});
