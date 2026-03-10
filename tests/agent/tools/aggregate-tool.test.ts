/**
 * AggregateTool — sum/avg/min/max/count/group_by/percentile/join/unique/flatten + 미커버 분기.
 */
import { describe, it, expect } from "vitest";
import { AggregateTool } from "@src/agent/tools/aggregate.js";

const tool = new AggregateTool();

describe("AggregateTool — 기본 동작", () => {
  it("sum: 숫자 배열 합계", async () => {
    const r = JSON.parse(await tool.execute({ action: "sum", data: "[1,2,3,4,5]" }));
    expect(r.result).toBe(15);
  });

  it("avg: 평균", async () => {
    const r = JSON.parse(await tool.execute({ action: "avg", data: "[10,20,30]" }));
    expect(r.result).toBe(20);
  });

  it("min/max", async () => {
    const min = JSON.parse(await tool.execute({ action: "min", data: "[3,1,4,1,5,9]" }));
    const max = JSON.parse(await tool.execute({ action: "max", data: "[3,1,4,1,5,9]" }));
    expect(min.result).toBe(1);
    expect(max.result).toBe(9);
  });

  it("count: 배열 크기", async () => {
    const r = JSON.parse(await tool.execute({ action: "count", data: "[1,2,3]" }));
    expect(r.result).toBe(3);
  });

  it("join: 구분자로 합치기", async () => {
    const r = JSON.parse(await tool.execute({ action: "join", data: '["a","b","c"]', separator: "-" }));
    expect(r.result).toBe("a-b-c");
  });

  it("unique: 중복 제거", async () => {
    const r = JSON.parse(await tool.execute({ action: "unique", data: "[1,2,2,3,3,3]" }));
    expect(r.result).toHaveLength(3);
  });

  it("flatten: 중첩 배열 평탄화", async () => {
    const r = JSON.parse(await tool.execute({ action: "flatten", data: "[[1,2],[3,[4]]]" }));
    expect(r.result).toContain(1);
    expect(r.result).toContain(3);
  });

  it("잘못된 data JSON → Error", async () => {
    const r = await tool.execute({ action: "sum", data: "not-json" });
    expect(r).toContain("Error");
  });
});

describe("AggregateTool — 미커버 분기 (L81)", () => {
  it("get_path: 중간 경로가 비객체 → L81 return undefined", async () => {
    // data=[{a:1}], field="a.nested" → a=1(number, not object) → L81 fires → undefined
    const r = JSON.parse(await tool.execute({ action: "sum", data: '[{"a":1}]', field: "a.nested" }));
    // 숫자 없음, 합계=0
    expect(r.result).toBe(0);
  });
});
