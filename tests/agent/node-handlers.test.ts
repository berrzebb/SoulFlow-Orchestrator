import { describe, it, expect } from "vitest";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";

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
