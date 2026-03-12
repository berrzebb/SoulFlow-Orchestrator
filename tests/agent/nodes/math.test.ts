import { describe, it, expect } from "vitest";
import { math_handler } from "@src/agent/nodes/math.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";

describe("${h^} Node Handler", () => {
  it("should have node_type", () => {
    const ctx: OrcheNodeExecutorContext = { memory: {} };
    const node = { node_id: "n", node_type: "math", label: "Test" };
    expect(math_handler.node_type).toBe("math");
  });

  it("should have output_schema", () => {
    const schema = math_handler.output_schema || [];
    expect(schema.length).toBeGreaterThan(0);
  });

  it("should execute", async () => {
    const ctx: OrcheNodeExecutorContext = { memory: {} };
    const node = { node_id: "n", node_type: "math" };
    const result = await math_handler.execute(node, ctx);
    expect(result).toBeDefined();
  });

  it("should validate", () => {
    const ctx: OrcheNodeExecutorContext = { memory: {} };
    const node = { node_id: "n", node_type: "math" };
    const result = math_handler.test(node, ctx);
    expect(result.preview).toBeDefined();
  });
});

// ── from math-extended.test.ts ──

describe("math_handler.test() — warning 분기", () => {
  it("operation=eval, expression 빈 문자열 → warning", () => {
    const node = { node_id: "n", node_type: "math", operation: "eval", expression: "" };
    const result = math_handler.test(node);
    expect(result.warnings).toContain("expression is required for eval");
  });

  it("operation=eval, expression 공백만 → warning", () => {
    const node = { node_id: "n", node_type: "math", operation: "eval", expression: "   " };
    const result = math_handler.test(node);
    expect(result.warnings).toContain("expression is required for eval");
  });

  it("operation=eval, expression 있음 → warning 없음", () => {
    const node = { node_id: "n", node_type: "math", operation: "eval", expression: "1+1" };
    const result = math_handler.test(node);
    expect(result.warnings).not.toContain("expression is required for eval");
  });

  it("operation=convert, from 없음 → warning", () => {
    const node = { node_id: "n", node_type: "math", operation: "convert", from: "", to: "km" };
    const result = math_handler.test(node);
    expect(result.warnings).toContain("from and to units are required for convert");
  });

  it("operation=convert, to 없음 → warning", () => {
    const node = { node_id: "n", node_type: "math", operation: "convert", from: "m", to: "" };
    const result = math_handler.test(node);
    expect(result.warnings).toContain("from and to units are required for convert");
  });

  it("operation=convert, from/to 모두 있음 → warning 없음", () => {
    const node = { node_id: "n", node_type: "math", operation: "convert", from: "m", to: "km" };
    const result = math_handler.test(node);
    expect(result.warnings).not.toContain("from and to units are required for convert");
  });

  it("다른 operation → warning 없음, preview에 operation 포함", () => {
    const node = { node_id: "n", node_type: "math", operation: "roi" };
    const result = math_handler.test(node);
    expect(result.warnings).toHaveLength(0);
    expect(result.preview).toMatchObject({ operation: "roi" });
  });
});
