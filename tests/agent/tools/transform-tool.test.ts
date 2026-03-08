/**
 * TransformTool — 11개 액션 완전 커버리지.
 */
import { describe, it, expect } from "vitest";
import { TransformTool } from "@src/agent/tools/transform.js";

const tool = new TransformTool();

const PEOPLE = JSON.stringify([
  { name: "Alice", age: 30, dept: "eng" },
  { name: "Bob", age: 25, dept: "design" },
  { name: "Charlie", age: 30, dept: "eng" },
]);

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("TransformTool — 메타데이터", () => {
  it("name = transform", () => expect(tool.name).toBe("transform"));
  it("category = data", () => expect(tool.category).toBe("data"));
  it("to_schema: function 형식", () => expect(tool.to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// pick
// ══════════════════════════════════════════

describe("TransformTool — pick", () => {
  it("객체에서 키 선택", async () => {
    const r = await tool.execute({ action: "pick", data: JSON.stringify({ a: 1, b: 2, c: 3 }), keys: "a,c" });
    const p = JSON.parse(r);
    expect(p).toEqual({ a: 1, c: 3 });
  });

  it("배열에서 각 항목 키 선택", async () => {
    const r = await tool.execute({ action: "pick", data: PEOPLE, keys: "name,age" });
    const p = JSON.parse(r);
    expect(p).toHaveLength(3);
    expect(p[0]).toEqual({ name: "Alice", age: 30 });
    expect(p[0].dept).toBeUndefined();
  });

  it("keys 없음 → 에러 반환", async () => {
    const r = await tool.execute({ action: "pick", data: PEOPLE });
    expect(r).toContain("Error");
  });

  it("배열이 아닌 값 → 그대로 반환", async () => {
    const r = await tool.execute({ action: "pick", data: '"hello"', keys: "a" });
    const p = JSON.parse(r);
    expect(p).toBe("hello");
  });
});

// ══════════════════════════════════════════
// omit
// ══════════════════════════════════════════

describe("TransformTool — omit", () => {
  it("객체에서 키 제외", async () => {
    const r = await tool.execute({ action: "omit", data: JSON.stringify({ a: 1, b: 2, c: 3 }), keys: "b" });
    const p = JSON.parse(r);
    expect(p).toEqual({ a: 1, c: 3 });
  });

  it("배열에서 각 항목 키 제외", async () => {
    const r = await tool.execute({ action: "omit", data: PEOPLE, keys: "dept" });
    const p = JSON.parse(r);
    expect(p[0].name).toBe("Alice");
    expect(p[0].dept).toBeUndefined();
  });

  it("keys 없음 → 에러 반환", async () => {
    const r = await tool.execute({ action: "omit", data: PEOPLE });
    expect(r).toContain("Error");
  });
});

// ══════════════════════════════════════════
// flatten
// ══════════════════════════════════════════

describe("TransformTool — flatten", () => {
  it("중첩 배열 평탄화", async () => {
    const r = await tool.execute({ action: "flatten", data: "[[1,2],[3,[4,5]]]" });
    const p = JSON.parse(r);
    expect(p).toEqual([1, 2, 3, 4, 5]);
  });

  it("배열 아닌 값 → 감싸서 반환", async () => {
    const r = await tool.execute({ action: "flatten", data: '"hello"' });
    const p = JSON.parse(r);
    expect(p).toEqual(["hello"]);
  });
});

// ══════════════════════════════════════════
// unflatten
// ══════════════════════════════════════════

describe("TransformTool — unflatten", () => {
  it("점 표기법 키 → 중첩 객체 복원", async () => {
    const flat = JSON.stringify({ "a.b.c": 1, "a.b.d": 2, "e": 3 });
    const r = await tool.execute({ action: "unflatten", data: flat });
    const p = JSON.parse(r);
    expect(p.a.b.c).toBe(1);
    expect(p.a.b.d).toBe(2);
    expect(p.e).toBe(3);
  });

  it("배열 입력 → 그대로 반환", async () => {
    const r = await tool.execute({ action: "unflatten", data: "[1,2,3]" });
    const p = JSON.parse(r);
    expect(p).toEqual([1, 2, 3]);
  });

  it("null → null 반환", async () => {
    const r = await tool.execute({ action: "unflatten", data: "null" });
    const p = JSON.parse(r);
    expect(p).toBeNull();
  });
});

// ══════════════════════════════════════════
// group_by
// ══════════════════════════════════════════

describe("TransformTool — group_by", () => {
  it("경로로 그룹화", async () => {
    const r = await tool.execute({ action: "group_by", data: PEOPLE, path: "dept" });
    const p = JSON.parse(r);
    expect(p.eng).toHaveLength(2);
    expect(p.design).toHaveLength(1);
  });

  it("배열 아닌 값 → 에러 반환", async () => {
    const r = await tool.execute({ action: "group_by", data: '{"a":1}', path: "a" });
    expect(r).toContain("Error");
  });

  it("path 없음 → 에러 반환", async () => {
    const r = await tool.execute({ action: "group_by", data: PEOPLE });
    expect(r).toContain("Error");
  });

  it("경로에 없는 값 → null 그룹", async () => {
    const r = await tool.execute({ action: "group_by", data: '[{"x":1},{"y":2}]', path: "x" });
    const p = JSON.parse(r);
    expect(p["null"]).toHaveLength(1); // y:2 항목
  });
});

// ══════════════════════════════════════════
// sort_by
// ══════════════════════════════════════════

describe("TransformTool — sort_by", () => {
  it("asc 정렬", async () => {
    const r = await tool.execute({ action: "sort_by", data: PEOPLE, path: "age", order: "asc" });
    const p = JSON.parse(r);
    expect(p[0].name).toBe("Bob"); // age 25
  });

  it("desc 정렬", async () => {
    const r = await tool.execute({ action: "sort_by", data: PEOPLE, path: "age", order: "desc" });
    const p = JSON.parse(r);
    expect(p[0].age).toBe(30);
  });

  it("문자열 정렬", async () => {
    const r = await tool.execute({ action: "sort_by", data: PEOPLE, path: "name", order: "asc" });
    const p = JSON.parse(r);
    expect(p[0].name).toBe("Alice");
  });

  it("배열 아닌 값 → 에러 반환", async () => {
    const r = await tool.execute({ action: "sort_by", data: '"str"', path: "a" });
    expect(r).toContain("Error");
  });

  it("path 없음 → 에러 반환", async () => {
    const r = await tool.execute({ action: "sort_by", data: PEOPLE });
    expect(r).toContain("Error");
  });
});

// ══════════════════════════════════════════
// unique
// ══════════════════════════════════════════

describe("TransformTool — unique", () => {
  it("중복 제거 (기본값 비교)", async () => {
    const r = await tool.execute({ action: "unique", data: "[1,2,2,3,1]" });
    const p = JSON.parse(r);
    expect(p).toEqual([1, 2, 3]);
  });

  it("경로로 중복 제거", async () => {
    const r = await tool.execute({ action: "unique", data: PEOPLE, path: "dept" });
    const p = JSON.parse(r);
    expect(p).toHaveLength(2); // eng, design
  });

  it("배열 아닌 값 → 에러 반환", async () => {
    const r = await tool.execute({ action: "unique", data: '"str"' });
    expect(r).toContain("Error");
  });
});

// ══════════════════════════════════════════
// zip
// ══════════════════════════════════════════

describe("TransformTool — zip", () => {
  it("두 배열 zip", async () => {
    const r = await tool.execute({ action: "zip", data: '["a","b","c"]', other: '[1,2,3]' });
    const p = JSON.parse(r);
    expect(p).toEqual([["a", 1], ["b", 2], ["c", 3]]);
  });

  it("길이 다른 배열 → 짧은 쪽 null 패딩", async () => {
    const r = await tool.execute({ action: "zip", data: '["a","b"]', other: '[1]' });
    const p = JSON.parse(r);
    expect(p[1][1]).toBeNull();
  });

  it("배열 아닌 data → 에러 반환", async () => {
    const r = await tool.execute({ action: "zip", data: '"str"', other: '[1]' });
    expect(r).toContain("Error");
  });

  it("other 유효하지 않은 JSON → 에러 반환", async () => {
    const r = await tool.execute({ action: "zip", data: '[1]', other: "bad" });
    expect(r).toContain("Error");
  });

  it("other 배열 아님 → 에러 반환", async () => {
    const r = await tool.execute({ action: "zip", data: '[1]', other: '{"a":1}' });
    expect(r).toContain("Error");
  });
});

// ══════════════════════════════════════════
// chunk
// ══════════════════════════════════════════

describe("TransformTool — chunk", () => {
  it("배열 청크 분할", async () => {
    const r = await tool.execute({ action: "chunk", data: '[1,2,3,4,5]', size: 2 });
    const p = JSON.parse(r);
    expect(p).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("배열 아닌 값 → 에러 반환", async () => {
    const r = await tool.execute({ action: "chunk", data: '"str"', size: 2 });
    expect(r).toContain("Error");
  });

  it("size < 1 → 에러 반환", async () => {
    const r = await tool.execute({ action: "chunk", data: '[1,2,3]', size: -1 });
    expect(r).toContain("Error");
  });
});

// ══════════════════════════════════════════
// reverse
// ══════════════════════════════════════════

describe("TransformTool — reverse", () => {
  it("배열 역순", async () => {
    const r = await tool.execute({ action: "reverse", data: '[1,2,3]' });
    const p = JSON.parse(r);
    expect(p).toEqual([3, 2, 1]);
  });

  it("배열 아닌 값 → 에러 반환", async () => {
    const r = await tool.execute({ action: "reverse", data: '"str"' });
    expect(r).toContain("Error");
  });
});

// ══════════════════════════════════════════
// map
// ══════════════════════════════════════════

describe("TransformTool — map", () => {
  it("경로로 필드 추출", async () => {
    const r = await tool.execute({ action: "map", data: PEOPLE, path: "name" });
    const p = JSON.parse(r);
    expect(p).toEqual(["Alice", "Bob", "Charlie"]);
  });

  it("중첩 경로 추출", async () => {
    const data = JSON.stringify([{ user: { id: 1 } }, { user: { id: 2 } }]);
    const r = await tool.execute({ action: "map", data, path: "user.id" });
    const p = JSON.parse(r);
    expect(p).toEqual([1, 2]);
  });

  it("배열 아닌 값 → 에러 반환", async () => {
    const r = await tool.execute({ action: "map", data: '{"a":1}', path: "a" });
    expect(r).toContain("Error");
  });

  it("path 없음 → 에러 반환", async () => {
    const r = await tool.execute({ action: "map", data: PEOPLE });
    expect(r).toContain("Error");
  });
});

// ══════════════════════════════════════════
// 에러 케이스
// ══════════════════════════════════════════

describe("TransformTool — 에러 케이스", () => {
  it("유효하지 않은 JSON data → 에러 반환", async () => {
    const r = await tool.execute({ action: "pick", data: "bad json", keys: "a" });
    expect(r).toContain("Error");
  });

  it("unsupported action → 에러 반환", async () => {
    const r = await tool.execute({ action: "nonexistent", data: "[]" });
    expect(r).toContain("Error");
  });
});
