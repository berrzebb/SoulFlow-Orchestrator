/**
 * math_handler — 미커버 분기 보충.
 * test(): eval+빈 expression 경고, convert+from/to 누락 경고.
 */
import { describe, it, expect } from "vitest";
import { math_handler } from "@src/agent/nodes/math.js";

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
