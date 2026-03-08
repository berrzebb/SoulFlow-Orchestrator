import { describe, it, expect } from "vitest";
import { date_calc_handler } from "../../../src/agent/nodes/date-calc.js";
import type { DateCalcNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("date_calc_handler", () => {
  const createMockNode = (overrides?: Partial<DateCalcNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "date_calc",
    operation: "now",
    date: "2024-01-01",
    date2: "2024-01-31",
    amount: 1,
    unit: "d",
    from_tz: "UTC",
    to_tz: "UTC",
    format: "YYYY-MM-DD",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be date_calc", () => {
    expect(date_calc_handler.node_type).toBe("date_calc");
  });

  it("metadata: output_schema should have result and success fields", () => {
    expect(date_calc_handler.output_schema).toEqual([
      { name: "result", type: "string", description: "Date calculation result" },
      { name: "success", type: "boolean", description: "Whether operation succeeded" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = date_calc_handler.create_default?.();
    expect(defaults).toEqual({
      operation: "now",
      date: "",
      date2: "",
      amount: 0,
      unit: "d",
      from_tz: "UTC",
      to_tz: "UTC",
      format: "YYYY-MM-DD",
    });
  });

  it("execute: should handle now operation", async () => {
    const node = createMockNode({ operation: "now" });
    const ctx = createMockContext();
    const result = await date_calc_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("result");
    expect(result.output).toHaveProperty("success");
  });

  it("execute: should resolve templates in date", async () => {
    const node = createMockNode({ operation: "add", date: "${start_date}", amount: 5, unit: "d" });
    const ctx = createMockContext({ start_date: "2024-01-01" });
    const result = await date_calc_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in date2", async () => {
    const node = createMockNode({ operation: "diff", date: "2024-01-01", date2: "${end_date}" });
    const ctx = createMockContext({ end_date: "2024-01-31" });
    const result = await date_calc_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should contain operation", () => {
    const node = createMockNode({ operation: "timezone" });
    const result = date_calc_handler.test(node);
    expect(result.preview).toEqual({ operation: "timezone" });
  });

  it("test: should have no warnings by default", () => {
    const node = createMockNode();
    const result = date_calc_handler.test(node);
    expect(result.warnings).toEqual([]);
  });

  it("execute: should handle missing operation (default to now)", async () => {
    const node = createMockNode({ operation: undefined });
    const ctx = createMockContext();
    const result = await date_calc_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle missing date (default to empty string)", async () => {
    const node = createMockNode({ date: undefined });
    const ctx = createMockContext();
    const result = await date_calc_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle add operation with multiple units", async () => {
    const node = createMockNode({ operation: "add", date: "2024-01-01", amount: 6, unit: "m" });
    const ctx = createMockContext();
    const result = await date_calc_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
