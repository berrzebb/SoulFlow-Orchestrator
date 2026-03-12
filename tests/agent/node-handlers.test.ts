import { describe, it, expect, vi } from "vitest";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";
import type {
  AggregateNodeDefinition,
  GateNodeDefinition,
  AssertNodeDefinition,
  RegexNodeDefinition,
  EncodingNodeDefinition,
} from "@src/agent/workflow-node.types.js";

/** 테스트용 최소 컨텍스트 빌더. */
function make_ctx(memory: Record<string, unknown> = {}): OrcheNodeExecutorContext {
  return { memory };
}

// ── Switch Handler ──────────────────────────────────

describe("switch_handler", async () => {
  const { switch_handler } = await import("@src/agent/nodes/switch.js");

  it("matches a case by expression result", async () => {
    const node = { node_type: "switch", expression: "'hello'", cases: [{ value: "hello", targets: ["n1"] }] } as any;
    const result = await switch_handler.execute(node, make_ctx());
    expect(result.output).toEqual({ matched_case: "hello" });
    expect(result.branch).toBe("hello");
  });

  it("returns default when no case matches", async () => {
    const node = { node_type: "switch", expression: "'xyz'", cases: [{ value: "a", targets: [] }] } as any;
    const result = await switch_handler.execute(node, make_ctx());
    expect(result.output).toEqual({ matched_case: "default" });
    expect(result.branch).toBe("default");
  });

  it("accesses memory in expression", async () => {
    const node = { node_type: "switch", expression: "memory.status", cases: [{ value: "active", targets: [] }] } as any;
    const result = await switch_handler.execute(node, make_ctx({ status: "active" }));
    expect(result.branch).toBe("active");
  });

  it("throws on invalid expression", async () => {
    const node = { node_type: "switch", expression: "throw new Error('boom')", cases: [] } as any;
    await expect(switch_handler.execute(node, make_ctx())).rejects.toThrow("switch expression evaluation failed");
  });

  it("test() warns on empty expression", () => {
    const node = { node_type: "switch", expression: "  ", cases: [] } as any;
    const result = switch_handler.test(node, make_ctx());
    expect(result.warnings).toContain("expression is empty");
  });

  it("test() reports expression error", () => {
    const node = { node_type: "switch", expression: "invalid(", cases: [] } as any;
    const result = switch_handler.test(node, make_ctx());
    expect(result.warnings.some((w: string) => w.includes("expression error"))).toBe(true);
  });
});

// ── If Handler ──────────────────────────────────────

describe("if_handler", async () => {
  const { if_handler } = await import("@src/agent/nodes/if.js");

  it("returns true branch when condition is truthy", async () => {
    const node = { node_type: "if", condition: "1 + 1 === 2" } as any;
    const result = await if_handler.execute(node, make_ctx());
    expect(result.output).toEqual({ condition_result: true, branch: "true" });
    expect(result.branch).toBe("true");
  });

  it("returns false branch when condition is falsy", async () => {
    const node = { node_type: "if", condition: "false" } as any;
    const result = await if_handler.execute(node, make_ctx());
    expect(result.output).toEqual({ condition_result: false, branch: "false" });
    expect(result.branch).toBe("false");
  });

  it("evaluates memory in condition", async () => {
    const node = { node_type: "if", condition: "memory.count > 5" } as any;
    expect((await if_handler.execute(node, make_ctx({ count: 10 }))).branch).toBe("true");
    expect((await if_handler.execute(node, make_ctx({ count: 2 }))).branch).toBe("false");
  });

  it("throws on syntax error", async () => {
    const node = { node_type: "if", condition: "invalid(" } as any;
    await expect(if_handler.execute(node, make_ctx())).rejects.toThrow("if condition evaluation failed");
  });

  it("test() evaluates empty condition as false branch", () => {
    const node = { node_type: "if", condition: "  " } as any;
    const result = if_handler.test(node, make_ctx());
    expect((result.preview as any).would_take).toBe("false");
  });
});

// ── Template Handler ────────────────────────────────

describe("template_handler", async () => {
  const { template_handler } = await import("@src/agent/nodes/template.js");

  it("resolves template variables from memory", async () => {
    const node = { node_type: "template", template: "Hello {{memory.name}}!" } as any;
    const result = await template_handler.execute(node, make_ctx({ name: "World" }));
    expect(result.output).toEqual({ text: "Hello World!" });
  });

  it("handles empty template", async () => {
    const node = { node_type: "template", template: "" } as any;
    const result = await template_handler.execute(node, make_ctx());
    expect(result.output).toEqual({ text: "" });
  });

  it("replaces missing variables with empty string", async () => {
    const node = { node_type: "template", template: "{{memory.missing}}" } as any;
    const result = await template_handler.execute(node, make_ctx());
    expect(result.output).toEqual({ text: "" });
  });
});

// ── Merge Handler ───────────────────────────────────

describe("merge_handler", async () => {
  const { merge_handler } = await import("@src/agent/nodes/merge.js");

  it("collect mode collects values from depends_on nodes", async () => {
    const node = { node_type: "merge", merge_mode: "collect", depends_on: ["nodeA", "nodeB"] } as any;
    const ctx = make_ctx({ nodeA: { x: 1 }, nodeB: { y: 2 } });
    const result = await merge_handler.execute(node, ctx);
    const output = result.output as { merged: unknown[] };
    expect(output.merged).toEqual([{ x: 1 }, { y: 2 }]);
  });

  it("wait_all mode merges depends_on as record", async () => {
    const node = { node_type: "merge", merge_mode: "wait_all", depends_on: ["step1"] } as any;
    const ctx = make_ctx({ step1: "done" });
    const result = await merge_handler.execute(node, ctx);
    const output = result.output as { merged: Record<string, unknown> };
    expect(output.merged).toEqual({ step1: "done" });
  });

  it("returns empty merged when no depends_on", async () => {
    const node = { node_type: "merge", merge_mode: "wait_all" } as any;
    const result = await merge_handler.execute(node, make_ctx());
    const output = result.output as { merged: Record<string, unknown> };
    expect(output.merged).toEqual({});
  });
});

// ── Set Handler ─────────────────────────────────────

describe("set_handler", async () => {
  const { set_handler } = await import("@src/agent/nodes/set.js");

  it("assigns values to memory and outputs them", async () => {
    const node = { node_type: "set", assignments: [{ key: "greeting", value: "hello" }] } as any;
    const ctx = make_ctx();
    const result = await set_handler.execute(node, ctx);
    expect(result.output).toEqual({ greeting: "hello" });
    expect(ctx.memory.greeting).toBe("hello");
  });

  it("resolves template variables in values", async () => {
    const node = { node_type: "set", assignments: [{ key: "msg", value: "Hi {{memory.name}}" }] } as any;
    const ctx = make_ctx({ name: "Bob" });
    const result = await set_handler.execute(node, ctx);
    expect(result.output).toEqual({ msg: "Hi Bob" });
  });

  it("sets nested keys using dot-notation", async () => {
    const node = { node_type: "set", assignments: [{ key: "a.b.c", value: "deep" }] } as any;
    const ctx = make_ctx();
    await set_handler.execute(node, ctx);
    expect((ctx.memory.a as any).b.c).toBe("deep");
  });

  it("test() returns resolved assignments preview", () => {
    const node = { node_type: "set", assignments: [{ key: "x", value: "{{memory.y}}" }] } as any;
    const result = set_handler.test(node, make_ctx({ y: 42 }));
    const preview = result.preview as { assignments: Array<{ key: string; resolved_value: unknown }> };
    expect(preview.assignments[0].resolved_value).toBe("42");
  });
});

// ── Filter Handler ──────────────────────────────────

describe("filter_handler", async () => {
  const { filter_handler } = await import("@src/agent/nodes/filter.js");

  it("filters array items by condition", async () => {
    const ctx = make_ctx({ items: [1, 2, 3, 4, 5] });
    const node = { node_type: "filter", condition: "item > 3", array_field: "items" } as any;
    const result = await filter_handler.execute(node, ctx);
    const output = result.output as { items: number[]; count: number; rejected: number };
    expect(output.items).toEqual([4, 5]);
    expect(output.count).toBe(2);
    expect(output.rejected).toBe(3);
  });

  it("returns empty when field is not an array", async () => {
    const ctx = make_ctx({ items: "not-an-array" });
    const node = { node_type: "filter", condition: "true", array_field: "items" } as any;
    const result = await filter_handler.execute(node, ctx);
    const output = result.output as { items: unknown[]; count: number };
    expect(output.items).toEqual([]);
    expect(output.count).toBe(0);
  });

  it("filters objects by property", async () => {
    const ctx = make_ctx({ users: [{ age: 20 }, { age: 30 }, { age: 15 }] });
    const node = { node_type: "filter", condition: "item.age >= 18", array_field: "users" } as any;
    const result = await filter_handler.execute(node, ctx);
    const output = result.output as { items: Array<{ age: number }>; count: number };
    expect(output.count).toBe(2);
  });

  it("skips items where condition throws", async () => {
    const ctx = make_ctx({ items: [1, null, 3] });
    const node = { node_type: "filter", condition: "item.toString() !== 'null'", array_field: "items" } as any;
    const result = await filter_handler.execute(node, ctx);
    const output = result.output as { items: unknown[] };
    // null.toString() doesn't throw but returns "null", so condition filters it
    expect(output.items).toEqual([1, 3]);
  });

  it("supports nested array_field via dot-notation", async () => {
    const ctx = make_ctx({ data: { list: [10, 20, 30] } });
    const node = { node_type: "filter", condition: "item < 25", array_field: "data.list" } as any;
    const result = await filter_handler.execute(node, ctx);
    const output = result.output as { items: number[] };
    expect(output.items).toEqual([10, 20]);
  });

  it("test() reports condition syntax error", () => {
    const node = { node_type: "filter", condition: "invalid(", array_field: "items" } as any;
    const result = filter_handler.test(node, make_ctx());
    expect(result.warnings.some((w: string) => w.includes("condition syntax error"))).toBe(true);
  });
});

// ── Transform Handler ───────────────────────────────

describe("transform_handler", async () => {
  const { transform_handler } = await import("@src/agent/nodes/transform.js");

  it("transforms array items with expression", async () => {
    const ctx = make_ctx({ items: [1, 2, 3] });
    const node = { node_type: "transform", expression: "item * 2", array_field: "items" } as any;
    const result = await transform_handler.execute(node, ctx);
    const output = result.output as { items: number[]; count: number };
    expect(output.items).toEqual([2, 4, 6]);
    expect(output.count).toBe(3);
  });

  it("returns null for items where expression throws", async () => {
    const ctx = make_ctx({ items: [1, null] });
    const node = { node_type: "transform", expression: "item.toFixed(2)", array_field: "items" } as any;
    const result = await transform_handler.execute(node, ctx);
    const output = result.output as { items: unknown[] };
    expect(output.items[0]).toBe("1.00");
    expect(output.items[1]).toBeNull();
  });

  it("returns empty when field is not an array", async () => {
    const ctx = make_ctx({ items: 42 });
    const node = { node_type: "transform", expression: "item", array_field: "items" } as any;
    const result = await transform_handler.execute(node, ctx);
    const output = result.output as { items: unknown[]; count: number };
    expect(output.items).toEqual([]);
    expect(output.count).toBe(0);
  });

  it("transforms objects", async () => {
    const ctx = make_ctx({ users: [{ name: "Alice" }, { name: "Bob" }] });
    const node = { node_type: "transform", expression: "item.name.toUpperCase()", array_field: "users" } as any;
    const result = await transform_handler.execute(node, ctx);
    const output = result.output as { items: string[] };
    expect(output.items).toEqual(["ALICE", "BOB"]);
  });

  it("test() reports expression syntax error", () => {
    const node = { node_type: "transform", expression: "bad(", array_field: "items" } as any;
    const result = transform_handler.test(node, make_ctx());
    expect(result.warnings.some((w: string) => w.includes("expression syntax error"))).toBe(true);
  });
});

// ── Wait Handler ────────────────────────────────────

describe("wait_handler", async () => {
  const { wait_handler } = await import("@src/agent/nodes/wait.js");

  it("timer mode completes with resumed_at", async () => {
    const node = { node_type: "wait", wait_type: "timer", delay_ms: 0 } as any;
    const result = await wait_handler.execute(node, make_ctx());
    const output = result.output as { resumed_at: string };
    expect(output.resumed_at).toBeTruthy();
    expect(new Date(output.resumed_at).getTime()).toBeGreaterThan(0);
  });

  it("clamps negative delay_ms to 0", async () => {
    const node = { node_type: "wait", wait_type: "timer", delay_ms: -100 } as any;
    const result = await wait_handler.execute(node, make_ctx());
    expect(result.output).toBeDefined();
  });

  it("non-timer types return immediately", async () => {
    const node = { node_type: "wait", wait_type: "webhook" } as any;
    const result = await wait_handler.execute(node, make_ctx());
    const output = result.output as { resumed_at: string; payload: null };
    expect(output.payload).toBeNull();
  });

  it("test() warns when delay exceeds maximum", () => {
    const node = { node_type: "wait", wait_type: "timer", delay_ms: 600_000 } as any;
    const result = wait_handler.test(node, make_ctx());
    expect(result.warnings.some((w: string) => w.includes("exceeds maximum"))).toBe(true);
  });

  it("test() no warnings for valid timer", () => {
    const node = { node_type: "wait", wait_type: "timer", delay_ms: 5000 } as any;
    const result = wait_handler.test(node, make_ctx());
    expect(result.warnings).toHaveLength(0);
  });
});

// ── from node-handlers-extended.test.ts ──

function make_ctx_ext(memory: Record<string, unknown> = {}): OrcheNodeExecutorContext {
  return { memory, abort_signal: undefined, workspace: undefined };
}

function agg_node(overrides: Partial<AggregateNodeDefinition> = {}): AggregateNodeDefinition {
  return {
    node_id: "agg1", title: "Agg", node_type: "aggregate",
    operation: "collect", array_field: "items",
    ...overrides,
  } as AggregateNodeDefinition;
}

describe("aggregate_handler", async () => {
  const { aggregate_handler } = await import("@src/agent/nodes/aggregate.js");

  it("collect — 배열 그대로 반환", async () => {
    const ctx = make_ctx_ext({ items: [1, 2, 3] });
    const { output } = await aggregate_handler.execute(agg_node(), ctx);
    expect(output).toEqual({ result: [1, 2, 3], count: 3 });
  });

  it("count — 배열 길이 반환", async () => {
    const ctx = make_ctx_ext({ items: ["a", "b"] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "count" }), ctx);
    expect(output).toEqual({ result: 2, count: 2 });
  });

  it("sum — 합계 계산", async () => {
    const ctx = make_ctx_ext({ items: [10, 20, 30] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "sum" }), ctx);
    expect(output).toEqual({ result: 60, count: 3 });
  });

  it("avg — 평균 계산", async () => {
    const ctx = make_ctx_ext({ items: [10, 20, 30] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "avg" }), ctx);
    expect(output).toEqual({ result: 20, count: 3 });
  });

  it("avg — 빈 배열 시 0 반환", async () => {
    const ctx = make_ctx_ext({ items: [] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "avg" }), ctx);
    expect(output).toEqual({ result: 0, count: 0 });
  });

  it("min — 최솟값", async () => {
    const ctx = make_ctx_ext({ items: [5, 2, 8] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "min" }), ctx);
    expect(output).toEqual({ result: 2, count: 3 });
  });

  it("max — 최댓값", async () => {
    const ctx = make_ctx_ext({ items: [5, 2, 8] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "max" }), ctx);
    expect(output).toEqual({ result: 8, count: 3 });
  });

  it("min — 비숫자만 있으면 null 반환 (Infinity 버그 수정)", async () => {
    const ctx = make_ctx_ext({ items: ["abc", "def"] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "min" }), ctx);
    expect(output).toEqual({ result: null, count: 2 });
  });

  it("max — 비숫자만 있으면 null 반환 (-Infinity 버그 수정)", async () => {
    const ctx = make_ctx_ext({ items: ["abc", "def"] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "max" }), ctx);
    expect(output).toEqual({ result: null, count: 2 });
  });

  it("join — 구분자로 결합", async () => {
    const ctx = make_ctx_ext({ items: ["a", "b", "c"] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "join", separator: ", " }), ctx);
    expect(output).toEqual({ result: "a, b, c", count: 3 });
  });

  it("join — 기본 구분자는 개행", async () => {
    const ctx = make_ctx_ext({ items: ["x", "y"] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "join" }), ctx);
    expect(output).toEqual({ result: "x\ny", count: 2 });
  });

  it("unique — 중복 제거", async () => {
    const ctx = make_ctx_ext({ items: ["a", "b", "a", "c", "b"] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "unique" }), ctx);
    expect(output).toEqual({ result: ["a", "b", "c"], count: 5 });
  });

  it("flatten — 중첩 배열 평탄화", async () => {
    const ctx = make_ctx_ext({ items: [[1, 2], [3, 4]] });
    const { output } = await aggregate_handler.execute(agg_node({ operation: "flatten" }), ctx);
    expect(output).toEqual({ result: [1, 2, 3, 4], count: 2 });
  });

  it("중첩 경로 접근 (dot notation)", async () => {
    const ctx = make_ctx_ext({ data: { nested: { nums: [100, 200] } } });
    const { output } = await aggregate_handler.execute(
      agg_node({ operation: "sum", array_field: "data.nested.nums" }), ctx,
    );
    expect(output).toEqual({ result: 300, count: 2 });
  });

  it("배열 인덱스 접근 (bracket notation)", async () => {
    const ctx = make_ctx_ext({ lists: [[10, 20, 30], [40, 50]] });
    const { output } = await aggregate_handler.execute(
      agg_node({ operation: "sum", array_field: "lists[0]" }), ctx,
    );
    expect(output).toEqual({ result: 60, count: 3 });
  });

  it("존재하지 않는 필드 → 빈 배열", async () => {
    const ctx = make_ctx_ext({});
    const { output } = await aggregate_handler.execute(agg_node({ array_field: "missing" }), ctx);
    expect(output).toEqual({ result: [], count: 0 });
  });

  it("test — array_field 비어 있으면 경고", () => {
    const result = aggregate_handler.test(agg_node({ array_field: "" }));
    expect(result.warnings).toContain("array_field is required");
  });
});

describe("gate_handler", async () => {
  const { gate_handler } = await import("@src/agent/nodes/gate.js");

  function gate_node(overrides: Partial<GateNodeDefinition> = {}): GateNodeDefinition {
    return {
      node_id: "gate1", title: "Gate", node_type: "gate",
      quorum: 2, depends_on: ["step_a", "step_b", "step_c"],
      ...overrides,
    } as GateNodeDefinition;
  }

  it("quorum 충족 시 quorum_met=true", async () => {
    const ctx = make_ctx_ext({ step_a: "done", step_b: "done" });
    const { output } = await gate_handler.execute(gate_node(), ctx);
    expect(output.quorum_met).toBe(true);
    expect(output.completed).toEqual(["step_a", "step_b"]);
    expect(output.pending).toEqual(["step_c"]);
  });

  it("quorum 미충족 시 quorum_met=false", async () => {
    const ctx = make_ctx_ext({ step_a: "done" });
    const { output } = await gate_handler.execute(gate_node(), ctx);
    expect(output.quorum_met).toBe(false);
    expect(output.completed).toEqual(["step_a"]);
    expect(output.pending).toEqual(["step_b", "step_c"]);
  });

  it("모든 소스 완료", async () => {
    const ctx = make_ctx_ext({ step_a: 1, step_b: 2, step_c: 3 });
    const { output } = await gate_handler.execute(gate_node(), ctx);
    expect(output.quorum_met).toBe(true);
    expect(output.completed).toHaveLength(3);
    expect(output.pending).toHaveLength(0);
    expect(output.results).toEqual({ step_a: 1, step_b: 2, step_c: 3 });
  });

  it("quorum=1 이면 하나만 완료돼도 통과", async () => {
    const ctx = make_ctx_ext({ step_c: "ok" });
    const { output } = await gate_handler.execute(gate_node({ quorum: 1 }), ctx);
    expect(output.quorum_met).toBe(true);
  });

  it("depends_on 없으면 빈 결과", async () => {
    const { output } = await gate_handler.execute(
      gate_node({ depends_on: [] }), make_ctx_ext(),
    );
    expect(output.completed).toEqual([]);
    expect(output.quorum_met).toBe(false);
  });

  it("test — depends_on 비어 있으면 경고", () => {
    const result = gate_handler.test(gate_node({ depends_on: [] }));
    expect(result.warnings).toContain("depends_on is empty — gate needs source nodes");
  });

  it("test — quorum이 소스 수 초과하면 경고", () => {
    const result = gate_handler.test(gate_node({ quorum: 5 }));
    expect(result.warnings.some((w) => w.includes("quorum exceeds"))).toBe(true);
  });
});

describe("assert_handler", async () => {
  const { assert_handler } = await import("@src/agent/nodes/assert.js");

  function assert_node(overrides: Partial<AssertNodeDefinition> = {}): AssertNodeDefinition {
    return {
      node_id: "assert1", title: "Assert", node_type: "assert",
      assertions: [], on_fail: "continue",
      ...overrides,
    } as AssertNodeDefinition;
  }

  it("모든 조건 통과 시 valid=true", async () => {
    const ctx = make_ctx_ext({ x: 10 });
    const { output } = await assert_handler.execute(assert_node({
      assertions: [{ condition: "memory.x > 5" }, { condition: "memory.x < 20" }],
    }), ctx);
    expect(output.valid).toBe(true);
    expect(output.errors).toEqual([]);
    expect(output.checked).toBe(2);
  });

  it("조건 실패 시 valid=false + 에러 메시지", async () => {
    const ctx = make_ctx_ext({ x: 3 });
    const { output } = await assert_handler.execute(assert_node({
      assertions: [{ condition: "memory.x > 5", message: "x must be > 5" }],
    }), ctx);
    expect(output.valid).toBe(false);
    expect(output.errors).toContain("x must be > 5");
  });

  it("on_fail=halt이면 에러 throw", async () => {
    const ctx = make_ctx_ext({ x: 0 });
    await expect(assert_handler.execute(assert_node({
      assertions: [{ condition: "memory.x > 0" }],
      on_fail: "halt",
    }), ctx)).rejects.toThrow("Assert failed");
  });

  it("잘못된 표현식은 에러 메시지에 포함", async () => {
    const ctx = make_ctx_ext({});
    const { output } = await assert_handler.execute(assert_node({
      assertions: [{ condition: "invalid syntax @@" }],
    }), ctx);
    expect(output.valid).toBe(false);
    expect(output.errors[0]).toContain("Expression error");
  });

  it("빈 assertions → valid=true, checked=0", async () => {
    const { output } = await assert_handler.execute(assert_node(), make_ctx_ext());
    expect(output.valid).toBe(true);
    expect(output.checked).toBe(0);
  });

  it("test — assertions 비어 있으면 경고", () => {
    const result = assert_handler.test(assert_node());
    expect(result.warnings).toContain("at least one assertion is required");
  });
});

describe("regex_handler", async () => {
  const { regex_handler } = await import("@src/agent/nodes/regex.js");

  function regex_node(overrides: Partial<RegexNodeDefinition> = {}): RegexNodeDefinition {
    return {
      node_id: "regex1", title: "Regex", node_type: "regex",
      operation: "match", input: "", pattern: "", flags: "", replacement: "",
      ...overrides,
    } as RegexNodeDefinition;
  }

  it("test 연산 — 매칭 여부 확인", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "test", input: "hello world", pattern: "world",
    }), make_ctx_ext());
    expect(output.success).toBe(true);
    expect(JSON.parse(output.result as string).matches).toBe(true);
  });

  it("test 연산 — 불일치", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "test", input: "hello", pattern: "world",
    }), make_ctx_ext());
    expect(JSON.parse(output.result as string).matches).toBe(false);
  });

  it("match 연산 — 첫 번째 매칭", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "match", input: "abc 123 def", pattern: "\\d+",
    }), make_ctx_ext());
    const parsed = JSON.parse(output.result as string);
    expect(parsed.found).toBe(true);
    expect(parsed.match).toBe("123");
  });

  it("match 연산 — 매칭 없음", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "match", input: "abc def", pattern: "\\d+",
    }), make_ctx_ext());
    const parsed = JSON.parse(output.result as string);
    expect(parsed.found).toBe(false);
  });

  it("match_all 연산 — 모든 매칭", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "match_all", input: "a1 b2 c3", pattern: "\\d", flags: "g",
    }), make_ctx_ext());
    const parsed = JSON.parse(output.result as string);
    expect(parsed.count).toBe(3);
    expect(parsed.matches.map((m: { match: string }) => m.match)).toEqual(["1", "2", "3"]);
  });

  it("replace 연산 — 치환", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "replace", input: "hello world", pattern: "world", replacement: "earth",
    }), make_ctx_ext());
    expect(output.result).toBe("hello earth");
  });

  it("replace 연산 — 글로벌 치환", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "replace", input: "aa bb aa", pattern: "aa", flags: "g", replacement: "cc",
    }), make_ctx_ext());
    expect(output.result).toBe("cc bb cc");
  });

  it("split 연산 — 분할", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "split", input: "a,b,,c", pattern: ",",
    }), make_ctx_ext());
    expect(JSON.parse(output.result as string)).toEqual(["a", "b", "", "c"]);
  });

  it("extract 연산 — 그룹 추출", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "extract", input: "name: Alice, age: 30", pattern: "(\\w+): (\\w+)", flags: "g",
    }), make_ctx_ext());
    const parsed = JSON.parse(output.result as string);
    expect(parsed.count).toBe(2);
    expect(parsed.extracted[0]).toEqual({ group_1: "name", group_2: "Alice" });
  });

  it("빈 pattern → 에러", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "test", input: "hello", pattern: "",
    }), make_ctx_ext());
    expect(output.success).toBe(false);
  });

  it("잘못된 regex → success=false", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "test", input: "hello", pattern: "[invalid",
    }), make_ctx_ext());
    expect(output.success).toBe(false);
  });

  it("지원하지 않는 연산 → success=false", async () => {
    const { output } = await regex_handler.execute(regex_node({
      operation: "unknown_op", input: "hello", pattern: "h",
    }), make_ctx_ext());
    expect(output.success).toBe(false);
  });

  it("test() — pattern 비어 있으면 경고", () => {
    const result = regex_handler.test(regex_node({ pattern: "" }));
    expect(result.warnings).toContain("pattern is required");
  });

  it("test() — 잘못된 regex면 경고", () => {
    const result = regex_handler.test(regex_node({ pattern: "[bad" }));
    expect(result.warnings).toContain("invalid regex pattern");
  });

  it("템플릿 변수 resolve (memory 접두사 필요)", async () => {
    const ctx = make_ctx_ext({ text: "hello 42 world", pat: "\\d+" });
    const { output } = await regex_handler.execute(regex_node({
      operation: "match", input: "{{memory.text}}", pattern: "{{memory.pat}}",
    }), ctx);
    const parsed = JSON.parse(output.result as string);
    expect(parsed.found).toBe(true);
    expect(parsed.match).toBe("42");
  });
});

describe("encoding_handler", async () => {
  const { encoding_handler } = await import("@src/agent/nodes/encoding.js");

  function enc_node(overrides: Partial<EncodingNodeDefinition> = {}): EncodingNodeDefinition {
    return {
      node_id: "enc1", title: "Encoding", node_type: "encoding",
      operation: "encode", input: "", format: "base64", count: 1,
      ...overrides,
    } as EncodingNodeDefinition;
  }

  it("base64 encode", async () => {
    const { output } = await encoding_handler.execute(enc_node({
      operation: "encode", input: "hello", format: "base64",
    }), make_ctx_ext());
    expect(output.result).toBe(Buffer.from("hello").toString("base64"));
    expect(output.success).toBe(true);
  });

  it("base64 decode", async () => {
    const encoded = Buffer.from("hello").toString("base64");
    const { output } = await encoding_handler.execute(enc_node({
      operation: "decode", input: encoded, format: "base64",
    }), make_ctx_ext());
    expect(output.result).toBe("hello");
  });

  it("hex encode", async () => {
    const { output } = await encoding_handler.execute(enc_node({
      operation: "encode", input: "AB", format: "hex",
    }), make_ctx_ext());
    expect(output.result).toBe(Buffer.from("AB").toString("hex"));
  });

  it("hex decode", async () => {
    const hex = Buffer.from("AB").toString("hex");
    const { output } = await encoding_handler.execute(enc_node({
      operation: "decode", input: hex, format: "hex",
    }), make_ctx_ext());
    expect(output.result).toBe("AB");
  });

  it("url encode", async () => {
    const { output } = await encoding_handler.execute(enc_node({
      operation: "encode", input: "hello world", format: "url",
    }), make_ctx_ext());
    expect(output.result).toBe("hello%20world");
  });

  it("url decode", async () => {
    const { output } = await encoding_handler.execute(enc_node({
      operation: "decode", input: "hello%20world", format: "url",
    }), make_ctx_ext());
    expect(output.result).toBe("hello world");
  });

  it("sha256 hash", async () => {
    const { output } = await encoding_handler.execute(enc_node({
      operation: "hash", input: "test", format: "sha256",
    }), make_ctx_ext());
    expect(output.success).toBe(true);
    expect((output.result as string).length).toBe(64);
  });

  it("md5 hash", async () => {
    const { output } = await encoding_handler.execute(enc_node({
      operation: "hash", input: "test", format: "md5",
    }), make_ctx_ext());
    expect(output.success).toBe(true);
    expect((output.result as string).length).toBe(32);
  });

  it("uuid — 단일 생성", async () => {
    const { output } = await encoding_handler.execute(enc_node({
      operation: "uuid",
    }), make_ctx_ext());
    expect(output.success).toBe(true);
    expect(output.result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);
  });

  it("uuid — 복수 생성", async () => {
    const { output } = await encoding_handler.execute(enc_node({
      operation: "uuid", count: 3,
    }), make_ctx_ext());
    const uuids = (output.result as string).split("\n");
    expect(uuids).toHaveLength(3);
    for (const u of uuids) expect(u).toMatch(/^[0-9a-f]{8}-/);
  });

  it("지원하지 않는 format → 에러 문자열", async () => {
    const { output } = await encoding_handler.execute(enc_node({
      operation: "encode", input: "x", format: "rot13",
    }), make_ctx_ext());
    expect(output.result).toContain("Unsupported");
  });

  it("지원하지 않는 operation → Unsupported", async () => {
    const { output } = await encoding_handler.execute(enc_node({
      operation: "compress", input: "x",
    }), make_ctx_ext());
    expect(output.result).toContain("Unsupported");
  });

  it("test() — uuid가 아닌데 input 없으면 경고", () => {
    const result = encoding_handler.test(enc_node({ operation: "encode", input: "" }));
    expect(result.warnings).toContain("input is required");
  });

  it("test() — uuid면 input 없어도 경고 없음", () => {
    const result = encoding_handler.test(enc_node({ operation: "uuid", input: "" }));
    expect(result.warnings).toHaveLength(0);
  });

  it("템플릿 변수 resolve (memory 접두사 필요)", async () => {
    const ctx = make_ctx_ext({ msg: "hello" });
    const { output } = await encoding_handler.execute(enc_node({
      operation: "encode", input: "{{memory.msg}}", format: "base64",
    }), ctx);
    expect(output.result).toBe(Buffer.from("hello").toString("base64"));
  });
});
