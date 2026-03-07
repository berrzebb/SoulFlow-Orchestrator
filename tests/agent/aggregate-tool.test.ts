import { describe, it, expect } from "vitest";
import { AggregateTool } from "@src/agent/tools/aggregate.js";

function make_tool(): AggregateTool {
  return new AggregateTool();
}

describe("AggregateTool", () => {
  describe("sum", () => {
    it("숫자 합계", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "sum", data: "[1,2,3,4,5]" }));
      expect(result.result).toBe(15);
      expect(result.count).toBe(5);
    });

    it("필드 경로로 합계", async () => {
      const data = JSON.stringify([{ val: 10 }, { val: 20 }, { val: 30 }]);
      const result = JSON.parse(await make_tool().execute({ action: "sum", data, field: "val" }));
      expect(result.result).toBe(60);
    });
  });

  describe("avg", () => {
    it("평균", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "avg", data: "[10,20,30]" }));
      expect(result.result).toBe(20);
    });

    it("빈 배열 → 0", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "avg", data: "[]" }));
      expect(result.result).toBe(0);
    });
  });

  describe("min / max", () => {
    it("최솟값", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "min", data: "[5,1,3]" }));
      expect(result.result).toBe(1);
    });

    it("최댓값", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "max", data: "[5,1,3]" }));
      expect(result.result).toBe(5);
    });

    it("빈 배열 → null", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "min", data: "[]" }));
      expect(result.result).toBeNull();
    });
  });

  describe("count", () => {
    it("배열 길이", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "count", data: "[1,2,3]" }));
      expect(result.result).toBe(3);
    });
  });

  describe("group_by", () => {
    it("필드별 그룹화", async () => {
      const data = JSON.stringify([
        { category: "A", val: 1 },
        { category: "B", val: 2 },
        { category: "A", val: 3 },
      ]);
      const result = JSON.parse(await make_tool().execute({ action: "group_by", data, field: "category" }));
      expect(result.result.A).toHaveLength(2);
      expect(result.result.B).toHaveLength(1);
      expect(result.group_count).toBe(2);
    });

    it("field 없으면 에러", async () => {
      const result = await make_tool().execute({ action: "group_by", data: "[1,2]" });
      expect(result).toContain("Error");
    });
  });

  describe("percentile", () => {
    it("중앙값 (50th percentile)", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "percentile", data: "[1,2,3,4,5]", percentile: 50 }));
      expect(result.result).toBe(3);
    });

    it("빈 배열 → null", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "percentile", data: "[]" }));
      expect(result.result).toBeNull();
    });
  });

  describe("join", () => {
    it("기본 쉼표 구분", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "join", data: '["a","b","c"]' }));
      expect(result.result).toBe("a,b,c");
    });

    it("커스텀 구분자", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "join", data: '["a","b"]', separator: " | " }));
      expect(result.result).toBe("a | b");
    });
  });

  describe("unique", () => {
    it("중복 제거", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "unique", data: '["a","b","a","c","b"]' }));
      expect(result.result).toEqual(["a", "b", "c"]);
      expect(result.count).toBe(3);
    });
  });

  describe("flatten", () => {
    it("중첩 배열 평탄화", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "flatten", data: "[[1,2],[3,4],[5]]" }));
      expect(result.result).toEqual([1, 2, 3, 4, 5]);
    });
  });

  it("잘못된 JSON → 에러", async () => {
    const result = await make_tool().execute({ action: "sum", data: "not-json" });
    expect(result).toContain("Error");
  });

  it("배열이 아닌 데이터 → 에러", async () => {
    const result = await make_tool().execute({ action: "sum", data: '{"a":1}' });
    expect(result).toContain("Error");
  });

  it("지원하지 않는 action → 에러", async () => {
    const result = await make_tool().execute({ action: "nope", data: "[]" });
    expect(result).toContain("unsupported action");
  });

  describe("중첩 필드 경로", () => {
    it("dot-notation으로 중첩 값 접근", async () => {
      const data = JSON.stringify([
        { user: { score: 10 } },
        { user: { score: 20 } },
      ]);
      const result = JSON.parse(await make_tool().execute({ action: "sum", data, field: "user.score" }));
      expect(result.result).toBe(30);
    });
  });
});
