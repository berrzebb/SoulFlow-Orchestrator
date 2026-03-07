import { describe, it, expect } from "vitest";
import { aggregate_handler } from "@src/agent/nodes/aggregate.js";
import type { AggregateNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";

function make_node(overrides: Partial<AggregateNodeDefinition> = {}): OrcheNodeDefinition {
  return {
    node_id: "agg1",
    node_type: "aggregate",
    label: "Aggregate",
    operation: "count",
    array_field: "items",
    ...overrides,
  } as OrcheNodeDefinition;
}

function make_ctx(memory: Record<string, unknown>): OrcheNodeExecutorContext {
  return { memory } as OrcheNodeExecutorContext;
}

describe("aggregate_handler.execute", () => {
  it("count — 배열 길이 반환", async () => {
    const r = await aggregate_handler.execute(
      make_node({ operation: "count", array_field: "items" }),
      make_ctx({ items: [1, 2, 3] }),
    );
    expect(r.output).toEqual({ result: 3, count: 3 });
  });

  it("sum — 합계", async () => {
    const r = await aggregate_handler.execute(
      make_node({ operation: "sum", array_field: "nums" }),
      make_ctx({ nums: [10, 20, 30] }),
    );
    expect(r.output).toEqual({ result: 60, count: 3 });
  });

  it("avg — 평균", async () => {
    const r = await aggregate_handler.execute(
      make_node({ operation: "avg", array_field: "nums" }),
      make_ctx({ nums: [10, 20, 30] }),
    );
    expect(r.output).toEqual({ result: 20, count: 3 });
  });

  it("avg — 빈 배열은 0", async () => {
    const r = await aggregate_handler.execute(
      make_node({ operation: "avg", array_field: "nums" }),
      make_ctx({ nums: [] }),
    );
    expect(r.output).toEqual({ result: 0, count: 0 });
  });

  it("min/max", async () => {
    const min_r = await aggregate_handler.execute(
      make_node({ operation: "min", array_field: "v" }),
      make_ctx({ v: [5, 1, 9] }),
    );
    expect((min_r.output as { result: number }).result).toBe(1);

    const max_r = await aggregate_handler.execute(
      make_node({ operation: "max", array_field: "v" }),
      make_ctx({ v: [5, 1, 9] }),
    );
    expect((max_r.output as { result: number }).result).toBe(9);
  });

  it("join — separator 지정", async () => {
    const r = await aggregate_handler.execute(
      make_node({ operation: "join", array_field: "words", separator: ", " } as Partial<AggregateNodeDefinition> as AggregateNodeDefinition),
      make_ctx({ words: ["a", "b", "c"] }),
    );
    expect((r.output as { result: string }).result).toBe("a, b, c");
  });

  it("unique — 중복 제거", async () => {
    const r = await aggregate_handler.execute(
      make_node({ operation: "unique", array_field: "tags" }),
      make_ctx({ tags: ["a", "b", "a", "c"] }),
    );
    expect((r.output as { result: string[] }).result).toEqual(["a", "b", "c"]);
  });

  it("flatten — 중첩 배열 평탄화", async () => {
    const r = await aggregate_handler.execute(
      make_node({ operation: "flatten", array_field: "nested" }),
      make_ctx({ nested: [[1, 2], [3, 4]] }),
    );
    expect((r.output as { result: number[] }).result).toEqual([1, 2, 3, 4]);
  });

  it("collect (기본) — 그대로 반환", async () => {
    const r = await aggregate_handler.execute(
      make_node({ operation: "collect", array_field: "items" }),
      make_ctx({ items: [1, 2] }),
    );
    expect((r.output as { result: number[] }).result).toEqual([1, 2]);
  });

  it("중첩 경로 해석 (dot notation)", async () => {
    const r = await aggregate_handler.execute(
      make_node({ operation: "count", array_field: "data.results" }),
      make_ctx({ data: { results: [1, 2, 3, 4] } }),
    );
    expect(r.output).toEqual({ result: 4, count: 4 });
  });

  it("존재하지 않는 경로 → 빈 배열", async () => {
    const r = await aggregate_handler.execute(
      make_node({ operation: "count", array_field: "missing.path" }),
      make_ctx({}),
    );
    expect(r.output).toEqual({ result: 0, count: 0 });
  });
});

describe("aggregate_handler.test", () => {
  it("array_field 누락 시 경고", () => {
    const r = aggregate_handler.test(make_node({ array_field: "" }));
    expect(r.warnings).toContain("array_field is required");
  });

  it("정상 시 경고 없음", () => {
    const r = aggregate_handler.test(make_node({ array_field: "items" }));
    expect(r.warnings).toHaveLength(0);
  });
});
